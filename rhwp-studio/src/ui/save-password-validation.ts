/** Same policy as the existing document save-password dialog. */
export function validateSavePassword(password: string, confirmation: string): 'short' | 'mismatch' | null {
  if (password.length < 5) return 'short';
  if (password !== confirmation) return 'mismatch';
  return null;
}
