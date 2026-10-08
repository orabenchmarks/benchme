/** A checkout's step page, its token captured: …/checkout/<24 characters of [0-9a-z]>/<step>. */
export const TOKEN_STEP = (step: string): RegExp => new RegExp(`/checkout/([0-9a-z]{24})/${step}$`);
