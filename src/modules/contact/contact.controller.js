import mongoose from "mongoose";
import ContactMessage from "./contactMessage.model.js";

const SUBJECTS = new Set([
  "Order Issue",
  "Product Question",
  "Astrologer Consultation",
  "Become a Seller",
  "Other",
]);

const cleanText = (value = "") => String(value || "").trim();

const formatContactMessage = (message) => {
  const data = message.toObject ? message.toObject() : message;
  return {
    id: data._id,
    name: data.name,
    email: data.email,
    phone: data.phone || "",
    subject: data.subject,
    message: data.message,
    userId: data.user?._id || data.user || "",
    userEmail: data.userEmail || data.user?.email || "",
    status: data.status || "unread",
    replies: Array.isArray(data.replies)
      ? data.replies.map((reply) => ({
          id: reply._id || "",
          message: reply.message || "",
          adminId: reply.admin?._id || reply.admin || "",
          adminEmail: reply.adminEmail || reply.admin?.email || "",
          createdAt: reply.createdAt,
        }))
      : [],
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
};

export const CreateContactMessage = async (req, res) => {
  try {
    const name = cleanText(req.body.name);
    const email = cleanText(req.body.email).toLowerCase();
    const phone = cleanText(req.body.phone).replace(/[^\d+ -]/g, "");
    const subject = SUBJECTS.has(req.body.subject) ? req.body.subject : "Other";
    const message = cleanText(req.body.message);
    const userId =
      req.body.userId && mongoose.Types.ObjectId.isValid(req.body.userId)
        ? req.body.userId
        : null;
    const userEmail = cleanText(req.body.userEmail).toLowerCase();

    if (!name || name.length > 120) {
      return res.status(400).json({ success: false, message: "Enter a valid name." });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: "Enter a valid email address." });
    }

    if (message.length < 3 || message.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Message must be between 3 and 2000 characters.",
      });
    }

    const savedMessage = await ContactMessage.create({
      name,
      email,
      phone,
      subject,
      message,
      user: userId,
      userEmail,
    });

    return res.status(201).json({
      success: true,
      message: "Message received successfully.",
      data: formatContactMessage(savedMessage),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetAdminContactMessages = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 12));
    const status = cleanText(req.query.status);
    const search = cleanText(req.query.search).toLowerCase();
    const filter = {};

    if (status === "read" || status === "unread") {
      filter.status = status;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
        { message: { $regex: search, $options: "i" } },
      ];
    }

    const [total, unread, messages] = await Promise.all([
      ContactMessage.countDocuments(filter),
      ContactMessage.countDocuments({ status: "unread" }),
      ContactMessage.find(filter)
        .populate("user", "email roles")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
    ]);

    return res.status(200).json({
      success: true,
      total,
      unread,
      page,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      messages: messages.map(formatContactMessage),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetMyContactMessages = async (req, res) => {
  try {
    const messages = await ContactMessage.find({ user: req.user.id })
      .populate("user", "email roles")
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return res.status(200).json({
      success: true,
      messages: messages.map(formatContactMessage),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const ReplyToContactMessage = async (req, res) => {
  try {
    const replyMessage = cleanText(req.body.message);

    if (replyMessage.length < 3 || replyMessage.length > 2000) {
      return res.status(400).json({
        success: false,
        message: "Reply must be between 3 and 2000 characters.",
      });
    }

    const message = await ContactMessage.findByIdAndUpdate(
      req.params.messageId,
      {
        $push: {
          replies: {
            message: replyMessage,
            admin: req.user.id,
            adminEmail: req.user.email || "",
          },
        },
        $set: { status: "read" },
      },
      { returnDocument: "after", runValidators: true },
    )
      .populate("user", "email roles")
      .lean();

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    return res.status(200).json({
      success: true,
      message: "Reply sent successfully.",
      data: formatContactMessage(message),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const UpdateContactMessageStatus = async (req, res) => {
  try {
    const status = req.body.status === "read" ? "read" : "unread";
    const message = await ContactMessage.findByIdAndUpdate(
      req.params.messageId,
      { $set: { status } },
      { returnDocument: "after", runValidators: true },
    )
      .populate("user", "email roles")
      .lean();

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    return res.status(200).json({
      success: true,
      message: "Message status updated.",
      data: formatContactMessage(message),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const DeleteContactMessage = async (req, res) => {
  try {
    const message = await ContactMessage.findByIdAndDelete(req.params.messageId).lean();

    if (!message) {
      return res.status(404).json({ success: false, message: "Message not found." });
    }

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully.",
      data: { id: message._id },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
