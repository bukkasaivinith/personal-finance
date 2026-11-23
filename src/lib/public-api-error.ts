type ApiFailure = { code?: string; message?: string };

const validationMessage = /^(?:Add|Choose|Enter|Give|Check|Set|Use|Select|Record|A |An |The |This |That |Your |You |Only |Invalid |Too many |No |Not enough |One or more |There |Keep |Cannot |Sign in )(?:[^\r\n]{0,199})$/i;

export function publicApiError(error: ApiFailure, fallback: string): Error {
  if (error.code === '28000') return new Error('Your session has expired. Please sign in again.');
  if (error.code === '42501') return new Error('This operation is unavailable for your account.');
  if (error.code === 'PGRST202') return new Error('The database update for this feature is pending.');
  if (error.code === 'P0001' && error.message && validationMessage.test(error.message) && !/[<>{}]/.test(error.message)
      && !/(?:\bSQLSTATE\b|\bSQL statement\b|\bLINE \d+|\bCONTEXT:|\bDETAIL:|https?:\/\/|postgres(?:ql)?:\/\/)/i.test(error.message)) {
    return new Error(error.message);
  }
  return new Error(fallback);
}
