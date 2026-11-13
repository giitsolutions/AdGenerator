function errorHandler(err, req, res, next) {
  // For axios errors, err.message is just "Request failed with status code X" —
  // the actual reason is in err.response.data. Log that too so we can debug.
  if (err.response) {
    console.error('[error]', err.message, '-', JSON.stringify(err.response.data));
  } else {
    console.error('[error]', err.message);
  }
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600
    ? err.status
    : 500;
  res.status(status).json({ error: err.message || 'Something went wrong' });
}

module.exports = errorHandler;
