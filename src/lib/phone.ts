// Client-side mirror of the backend's phone_validation.ts. Kept as a plain
// module (NOT "use server") so both guest pages and dashboard forms can import
// it and validate as the user types, instead of only finding out on submit.
//
// Product rule (Indian mobile): a guest/staff mobile number is EXACTLY 10
// digits. Nothing shorter, nothing longer. Formatting noise (spaces, dashes,
// brackets, a leading "+91" / "0091" / "0") is stripped before the length is
// checked, so a number pasted out of a contacts app still validates.
//
// Deliberately NOT enforced: a leading 6-9 series check — the codebase never
// had one, and the backend does not either.
//
// Scope: NEW writes only. Numbers already stored with other lengths are shown
// as-is and lookup fields (loyalty, coupons) are not gated — same split the
// backend made.

/** The one message shown for a bad mobile number. Byte-for-byte the backend's 400. */
export const MOBILE_10_ERROR = 'Enter a 10-digit mobile number';

/** Digits only, for counting and for `maxLength`-style trimming. */
export const phoneDigits = (raw: unknown): string =>
    raw === null || raw === undefined ? '' : String(raw).replace(/[^0-9]/g, '');

/**
 * Strip formatting and return the number only when it is exactly 10 digits.
 * Peels an Indian country code / trunk zero, but only ever DOWN TO 10 digits,
 * so a 9-digit number stays 9 digits and is rejected. Returns null when invalid.
 */
export const normalizeMobile10 = (raw: unknown): string | null => {
    let digits = phoneDigits(raw);
    if (digits.length === 13 && digits.startsWith('0091')) {digits = digits.slice(4);}
    if (digits.length === 12 && digits.startsWith('91')) {digits = digits.slice(2);}
    if (digits.length === 11 && digits.startsWith('0')) {digits = digits.slice(1);}
    return digits.length === 10 ? digits : null;
};

/** True when the value is a usable 10-digit mobile number. */
export const isMobile10 = (raw: unknown): boolean => normalizeMobile10(raw) !== null;

/**
 * Optional-field variant: blank is fine, but anything typed must be 10 digits.
 * Mirrors the backend's normalizeOptionalMobile10.
 */
export const isOptionalMobile10 = (raw: unknown): boolean => {
    const s = raw === null || raw === undefined ? '' : String(raw).trim();
    return s.length === 0 || isMobile10(s);
};

/**
 * Live validation message for an input, or null when the field is acceptable.
 * `required` fields report the same message while empty, so submit stays
 * blocked with one consistent sentence rather than two different ones.
 */
export const mobile10Error = (raw: unknown, required = true): string | null => {
    const s = raw === null || raw === undefined ? '' : String(raw).trim();
    if (s.length === 0) {return required ? MOBILE_10_ERROR : null;}
    return isMobile10(s) ? null : MOBILE_10_ERROR;
};

/**
 * What a phone input's value should become after the user types or pastes.
 *
 * Strips non-digits, peels an Indian country code / trunk zero, then caps at 10
 * digits — so the field never holds more than 10 digits, and pasting
 * "+91 98765 43210" or "919876543210" lands on "9876543210" instead of being
 * silently truncated into a DIFFERENT valid-looking number.
 *
 * Use this in every phone input's onChange. It is why PHONE_INPUT_PROPS.maxLength
 * is 13 rather than 10: the browser applies maxLength BEFORE onChange fires, so a
 * hard cap of 10 would destroy a prefixed paste before this could fix it. The
 * value the user sees is still never longer than 10 digits.
 */
export const sanitizePhoneInput = (raw: string): string => {
    let digits = phoneDigits(raw);
    if (digits.length >= 13 && digits.startsWith('0091')) {digits = digits.slice(4);}
    else if (digits.length >= 12 && digits.startsWith('91')) {digits = digits.slice(2);}
    else if (digits.length >= 11 && digits.startsWith('0')) {digits = digits.slice(1);}
    return digits.slice(0, 10);
};

/**
 * Props every phone `<input>` on the web should spread, so the keyboard, the
 * accepted characters and the cap are identical everywhere. Pair with
 * `sanitizePhoneInput` in onChange — see the note there about maxLength.
 */
export const PHONE_INPUT_PROPS = {
    inputMode: 'numeric' as const,
    autoComplete: 'tel' as const,
    maxLength: 13,
    pattern: '[0-9]*',
} as const;
