//! Deliberately bounded structural editing: body table -> cell -> plain table.
//! A locator alone is not an identity. Bind each edit to the queried document
//! epoch/revision and complete host paragraph before touching the model.
use crate::document_core::DocumentCore;
use crate::error::HwpError;
use crate::model::{control::Control, event::DocumentEvent, table::Table};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RowPathEntry {
    control_index: u32,
    cell_index: u32,
    cell_para_index: u32,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
enum RowAction {
    InsertAbove,
    InsertBelow,
    Delete,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RowEdit {
    path: [RowPathEntry; 2],
    expected_token: String,
    action: RowAction,
}

fn invalid(message: impl Into<String>) -> HwpError {
    HwpError::RenderError(message.into())
}

fn plain_grid(table: &Table) -> Result<(), HwpError> {
    let count = usize::from(table.row_count) * usize::from(table.col_count);
    if !table.zones.is_empty()
        || !table.local_resize_rows.is_empty()
        || !table.local_resize_cols.is_empty()
        || !table.local_resize_cell_widths.is_empty()
        || !table.local_resize_cell_heights.is_empty()
        || count == 0
        || count > crate::model::table::MAX_TABLE_GRID_CELLS
        || table.cells.len() != count
        || table.cell_grid.len() != count
    {
        return Err(invalid("안쪽 표의 셀 구조를 지원하지 않습니다"));
    }
    for (i, entry) in table.cell_grid.iter().enumerate() {
        let cell = entry
            .and_then(|index| table.cells.get(index))
            .ok_or_else(|| invalid("안쪽 표의 셀 경로가 유효하지 않습니다"))?;
        if usize::from(cell.row) != i / usize::from(table.col_count)
            || usize::from(cell.col) != i % usize::from(table.col_count)
            || cell.cell_protect()
            || cell.row_span != 1
            || cell.col_span != 1
            || cell
                .paragraphs
                .iter()
                .any(|p| p.controls.iter().any(|c| matches!(c, Control::Table(_))))
        {
            return Err(invalid(
                "병합 셀이나 더 깊은 안쪽 표의 줄 편집은 아직 지원하지 않습니다",
            ));
        }
    }
    // Independent resized row/column frames need a separate remapping/layout
    // contract. Accept regular column widths and per-row cell heights only.
    for cell in &table.cells {
        let column = &table.cells[table.cell_grid[usize::from(cell.col)].unwrap()];
        let row = &table.cells
            [table.cell_grid[usize::from(cell.row) * usize::from(table.col_count)].unwrap()];
        if cell.width != column.width || cell.height != row.height {
            return Err(invalid(
                "독립 경계 크기가 있는 안쪽 표의 줄 편집은 아직 지원하지 않습니다",
            ));
        }
    }
    Ok(())
}

fn may_delete(table: &Table, row: u16) -> bool {
    table.row_count > 1
        && table.cells.iter().filter(|c| c.row == row).all(|c| {
            c.field_name.as_ref().is_none_or(|name| name.is_empty())
                && c.paragraphs.iter().all(|p| {
                    p.controls.is_empty()
                        && p.field_ranges.is_empty()
                        && p.orphan_field_ends.is_empty()
                        && p.range_tags.is_empty()
                        && p.title_marks.is_empty()
                        && p.ctrl_data_records.iter().all(Option::is_none)
                })
        })
}

impl DocumentCore {
    fn nested_row_table<'a>(
        &'a self,
        section: usize,
        parent: usize,
        path: &[RowPathEntry; 2],
    ) -> Result<&'a Table, HwpError> {
        let host = self
            .document
            .sections
            .get(section)
            .and_then(|s| s.paragraphs.get(parent))
            .ok_or_else(|| invalid("안쪽 표의 본문 문단 경로가 유효하지 않습니다"))?;
        let Some(Control::Table(root)) = host.controls.get(path[0].control_index as usize) else {
            return Err(invalid("본문 표 안의 표만 줄 편집을 지원합니다"));
        };
        let outer_cell = root
            .cells
            .get(path[0].cell_index as usize)
            .ok_or_else(|| invalid("안쪽 표의 부모 셀 경로가 유효하지 않습니다"))?;
        if outer_cell.cell_protect() {
            return Err(invalid("보호된 부모 셀 안의 줄은 편집할 수 없습니다"));
        }
        let inner_host = outer_cell
            .paragraphs
            .get(path[0].cell_para_index as usize)
            .ok_or_else(|| invalid("안쪽 표의 부모 셀 경로가 유효하지 않습니다"))?;
        let Some(Control::Table(table)) = inner_host.controls.get(path[1].control_index as usize)
        else {
            return Err(invalid("안쪽 표 경로가 표를 가리키지 않습니다"));
        };
        plain_grid(table)?;
        table
            .cells
            .get(path[1].cell_index as usize)
            .and_then(|c| c.paragraphs.get(path[1].cell_para_index as usize))
            .ok_or_else(|| invalid("안쪽 표의 편집 셀 경로가 유효하지 않습니다"))?;
        Ok(table)
    }

    fn nested_row_token(
        &self,
        section: usize,
        parent: usize,
        path: &[RowPathEntry; 2],
    ) -> Result<String, HwpError> {
        let path = path
            .iter()
            .map(|p| (p.control_index, p.cell_index, p.cell_para_index))
            .collect::<Vec<_>>();
        let bytes = serde_json::to_vec(&(
            self.render_normalization.document_epoch,
            self.render_normalization.section_revisions.get(section),
            section,
            parent,
            path,
            &self.document.sections[section].paragraphs[parent],
        ))
        .map_err(|e| invalid(e.to_string()))?;
        Ok(Sha256::digest(bytes)
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect())
    }

    /// Strict depth-two target query. No defaulting/coercion of path indices.
    pub fn get_nested_table_row_target_native(
        &self,
        section: usize,
        parent: usize,
        path_json: &str,
    ) -> Result<String, HwpError> {
        let path: [RowPathEntry; 2] =
            serde_json::from_str(path_json).map_err(|e| invalid(e.to_string()))?;
        let table = self.nested_row_table(section, parent, &path)?;
        let cell = &table.cells[path[1].cell_index as usize];
        let can_insert = table.row_count < u16::MAX
            && (usize::from(table.row_count) + 1) * usize::from(table.col_count)
                <= crate::model::table::MAX_TABLE_GRID_CELLS;
        Ok(
            json!({"ok":true,"token":self.nested_row_token(section, parent, &path)?,
            "row":cell.row,"col":cell.col,"rowCount":table.row_count,"colCount":table.col_count,
            "canInsert":can_insert,"canDelete":may_delete(table, cell.row)})
            .to_string(),
        )
    }

    /// Clone only the inner table, validate/prepare all changes, then commit.
    /// Deleting a row with reference/control owners is outside this first scope.
    pub fn edit_nested_table_row_native(
        &mut self,
        section: usize,
        parent: usize,
        options_json: &str,
    ) -> Result<String, HwpError> {
        let options: RowEdit =
            serde_json::from_str(options_json).map_err(|e| invalid(e.to_string()))?;
        let path = &options.path;
        let table = self.nested_row_table(section, parent, path)?;
        if options.expected_token != self.nested_row_token(section, parent, path)? {
            return Err(invalid(
                "표 위치나 내용이 바뀌었습니다. 편집할 셀을 다시 선택하세요",
            ));
        }
        let cell = &table.cells[path[1].cell_index as usize];
        let (row, col) = (cell.row, cell.col);
        if matches!(options.action, RowAction::Delete) && !may_delete(table, row) {
            return Err(invalid(
                "마지막 줄이나 필드·제어 개체가 있는 안쪽 줄은 지울 수 없습니다",
            ));
        }
        if !matches!(options.action, RowAction::Delete)
            && (usize::from(table.row_count) + 1) * usize::from(table.col_count)
                > crate::model::table::MAX_TABLE_GRID_CELLS
        {
            return Err(invalid("표 크기 한도를 초과합니다"));
        }
        let mut staged = table.clone();
        match options.action {
            RowAction::InsertAbove => staged.insert_row(row, false),
            RowAction::InsertBelow => staged.insert_row(row, true),
            RowAction::Delete => staged.delete_row(row),
        }
        .map_err(invalid)?;
        staged.local_resize_cell_widths.clear();
        staged.local_resize_cell_heights.clear();
        staged.dirty = true;
        let next_row = match options.action {
            RowAction::InsertAbove => row + 1,
            RowAction::InsertBelow => row,
            RowAction::Delete => row.min(staged.row_count - 1),
        };
        let next_cell = staged.cell_grid
            [usize::from(next_row) * usize::from(staged.col_count) + usize::from(col)]
        .ok_or_else(|| invalid("변경 후 셀 경로가 유효하지 않습니다"))?;
        let result = json!({"ok":true,"rowCount":staged.row_count,"colCount":staged.col_count,
            "cellIndex":next_cell,"cellParaIndex":if matches!(options.action, RowAction::Delete) {0} else {path[1].cell_para_index}}).to_string();
        // Traversal was fully checked against the unchanged model above.
        let Control::Table(root) = &mut self.document.sections[section].paragraphs[parent].controls
            [path[0].control_index as usize]
        else {
            unreachable!()
        };
        let host = &mut root.cells[path[0].cell_index as usize].paragraphs
            [path[0].cell_para_index as usize];
        host.controls[path[1].control_index as usize] = Control::Table(Box::new(staged));
        self.mark_cell_control_dirty(section, parent, path[0].control_index as usize);
        self.document.sections[section].raw_stream = None;
        self.recompose_section(section);
        self.paginate_if_needed();
        self.event_log
            .push(if matches!(options.action, RowAction::Delete) {
                DocumentEvent::TableRowDeleted {
                    section,
                    para: parent,
                    ctrl: path[0].control_index as usize,
                }
            } else {
                DocumentEvent::TableRowInserted {
                    section,
                    para: parent,
                    ctrl: path[0].control_index as usize,
                }
            });
        Ok(result)
    }
}
