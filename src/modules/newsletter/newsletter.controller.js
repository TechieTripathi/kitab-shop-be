import NewsletterSubscriber from "./NewsletterSubscriber.model.js";

export const SubscribeToNewsletter = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();

    await NewsletterSubscriber.create({ email });

    return res.status(201).json({
      success: true,
      message: "Subscribed! Watch your inbox for updates.",
    });
  } catch (error) {
    if (error.code === 11000) {
      // Already on the list — treat resubmission as success rather than an
      // error, since from the visitor's side nothing actually went wrong.
      return res.status(200).json({
        success: true,
        message: "You're already subscribed!",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetNewsletterSubscribers = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));

    const [total, subscribers] = await Promise.all([
      NewsletterSubscriber.countDocuments(),
      NewsletterSubscriber.find()
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      data: subscribers.map((subscriber) => ({
        id: subscriber._id,
        email: subscriber.email,
        createdAt: subscriber.createdAt,
      })),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
