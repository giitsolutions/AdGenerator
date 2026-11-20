const STATUS_TRANSITIONS = {
  generated: ['ready_to_post'],
  ready_to_post: ['ready_to_post', 'generated', 'scheduled', 'posted'],
  scheduled: ['ready_to_post', 'posted'],
  posted: []
};

const CONTENT_STATUSES = Object.freeze(Object.keys(STATUS_TRANSITIONS));

function createTransitionError(currentStatus, nextStatus) {
  const current = currentStatus || 'unknown';
  const error = new Error(`Invalid content status transition: ${current} -> ${nextStatus}.`);
  error.status = 409;
  error.code = 'INVALID_STATUS_TRANSITION';
  return error;
}

function assertTransition(currentStatus, nextStatus) {
  if (!STATUS_TRANSITIONS[currentStatus] ||
      !STATUS_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw createTransitionError(currentStatus, nextStatus);
  }
}

module.exports = {
  CONTENT_STATUSES,
  assertTransition,
  createTransitionError
};
