const logger = {
  log(context, data = {}) {
    console.log(JSON.stringify({ context, ...data, time: new Date().toISOString() }));
  },

  error(context, err, extra = {}) {
    console.error(JSON.stringify({
      context,
      message: err?.message ?? null,
      stack:   err?.stack   ?? null,
      ...extra,
      time: new Date().toISOString(),
    }));
  },
};

module.exports = logger;
