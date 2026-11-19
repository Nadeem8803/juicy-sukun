export type DomainErrorCode =
  | 'shop_closed'
  | 'invalid_request'
  | 'invalid_item'
  | 'item_unavailable'
  | 'blocked'
  | 'too_many_orders'
  | 'invalid_transition'
  | 'reason_required'
  | 'not_found'
  | 'forbidden'
  | 'too_far';

/** Business-rule failure. Cloud Functions map the code to an HttpsError; the apps map it to a message. */
export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const USER_MESSAGES: Record<DomainErrorCode, string> = {
  shop_closed: 'We are offline right now. Please try again when we reopen.',
  invalid_request: 'Please check your details and try again.',
  invalid_item: 'One of the items is no longer on the menu. Please refresh.',
  item_unavailable: 'One of the items is sold out right now.',
  blocked: 'We cannot take orders from this number.',
  too_many_orders: 'You already have orders waiting. Please wait for the cafe to respond.',
  invalid_transition: 'That order has already changed. Please refresh.',
  reason_required: 'Please give a short reason.',
  not_found: 'Order not found.',
  forbidden: 'You are not allowed to do that.',
  too_far: 'Sorry, this address is outside our delivery area.',
};
