export const TAKEOFF_ERROR_B1_MESSAGE = 'Error B1: Vision scan is temporarily unavailable. Please contact support.';
export const TAKEOFF_GENERIC_ANALYSIS_ERROR = 'Vision scan could not be completed. Please try again or contact support.';

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

export function isLowBalanceAnalysisError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();

  if (message.startsWith('error b1')) return true;

  return (
    message.includes('credit balance') ||
    message.includes('plans & billing') ||
    message.includes('plans and billing') ||
    message.includes('billing to upgrade') ||
    message.includes('low to access')
  );
}

export function getPublicAnalysisError(error: unknown) {
  if (isLowBalanceAnalysisError(error)) {
    return TAKEOFF_ERROR_B1_MESSAGE;
  }

  return TAKEOFF_GENERIC_ANALYSIS_ERROR;
}
