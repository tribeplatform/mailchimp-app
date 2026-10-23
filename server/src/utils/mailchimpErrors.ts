/**
 * HTTP status of a failed Mailchimp call, from an axios error (`response.status`)
 * or an error that carries it directly (`status`).
 */
export const mailchimpErrorStatus = (error: any): number | undefined => error?.status ?? error?.response?.status;

/** Mailchimp answered that the resource doesn't exist (as opposed to 403/429/5xx or a network error). */
export const isMailchimpNotFound = (error: any): boolean => mailchimpErrorStatus(error) === 404;
