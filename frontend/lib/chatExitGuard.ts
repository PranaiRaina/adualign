export const CHAT_EXIT_REQUEST_EVENT = 'adu-chat:request-exit';

export type ChatExitReason = 'logout';

export interface ChatExitRequestDetail {
  reason: ChatExitReason;
  handled: boolean;
  proceed: () => void;
}

export function requestChatExit(request: Omit<ChatExitRequestDetail, 'handled'>) {
  if (typeof window === 'undefined') {
    request.proceed();
    return;
  }

  const detail: ChatExitRequestDetail = {
    ...request,
    handled: false,
  };

  window.dispatchEvent(new CustomEvent<ChatExitRequestDetail>(CHAT_EXIT_REQUEST_EVENT, { detail }));

  if (!detail.handled) {
    detail.proceed();
  }
}
