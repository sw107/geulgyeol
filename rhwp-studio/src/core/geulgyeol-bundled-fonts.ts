// Host-owned additions to the upstream generated catalog. These two files are
// already copied by scripts/build.sh; enabling this does not replace font bytes.
export const GEULGYEOL_BUNDLED_FONTS = typeof __GEULGYEOL_BUNDLED_NANUM__ !== 'undefined'
  && __GEULGYEOL_BUNDLED_NANUM__ === true
  ? [
    {
      file: 'fonts/NanumGothic-ExtraBold.woff2',
      aliases: ['나눔고딕 ExtraBold', 'NanumGothicExtraBold'],
      ruleId: 'rule.geulgyeol-bundle.nanum-gothic-extrabold',
    },
    {
      file: 'fonts/NanumMyeongjo-ExtraBold.woff2',
      aliases: ['나눔명조 ExtraBold', 'NanumMyeongjoExtraBold'],
      ruleId: 'rule.geulgyeol-bundle.nanum-myeongjo-extrabold',
    },
  ] as const
  : [];
