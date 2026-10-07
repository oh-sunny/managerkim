const STORED_DRAFT_ID = /^[a-zA-Z0-9-]{1,100}$/;

/** Keep existing safe IDs stable; give every other ticket ID a stable DB-safe key. */
export async function draftStorageId(ticketId) {
  if (typeof ticketId !== 'string' || !ticketId) throw new TypeError('티켓 ID를 확인해주세요.');
  if (STORED_DRAFT_ID.test(ticketId)) return ticketId;
  if (!globalThis.crypto?.subtle) throw new Error('초안 저장에 필요한 보안 기능을 사용할 수 없습니다.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticketId));
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return `ticket-${hex}`;
}
