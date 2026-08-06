const noopSend = async ({ channel }) => ({
  provider: "noop",
  status: "queued",
  response: {
    channel,
    message: "Provider integration is not enabled",
  },
});

const adapters = {
  sms: noopSend,
  whatsapp: noopSend,
  phone: noopSend,
};

export const sendNotificationChannel = async ({ channel, event, payload }) => {
  const adapter = adapters[channel] || noopSend;
  return adapter({ channel, event, payload });
};
