import AboutPage from "./AboutPage.model.js";
import { createAuditLog } from "../audit/audit-log.js";

const defaultFont = {
  fontFamily: "default",
  fontSize: 14,
  fontWeight: "normal",
  fontStyle: "normal",
  textColor: "#4B5563",
};

const normalizeFont = (font = {}, fallback = defaultFont) => ({
  fontFamily: ["default", "serif", "sans", "mono"].includes(font.fontFamily) ? font.fontFamily : fallback.fontFamily,
  fontSize: Math.min(96, Math.max(1, Number(font.fontSize) || fallback.fontSize)),
  fontWeight: ["normal", "medium", "semibold", "bold"].includes(font.fontWeight) ? font.fontWeight : fallback.fontWeight,
  fontStyle: ["normal", "italic"].includes(font.fontStyle) ? font.fontStyle : fallback.fontStyle,
  textColor: String(font.textColor || fallback.textColor || "#4B5563"),
});

const normalizeTextBlock = (block = {}, fallback = {}) => ({
  text: String(block.text ?? fallback.text ?? ""),
  enabled: block.enabled !== false,
  font: normalizeFont(block.font || {}, fallback.font || defaultFont),
});

const normalizeSection = (section = {}, fallback = {}) => ({
  heading: String(section.heading ?? fallback.heading ?? ""),
  body: String(section.body ?? fallback.body ?? ""),
  enabled: section.enabled !== false,
  headingFont: normalizeFont(section.headingFont || {}, fallback.headingFont || { ...defaultFont, fontSize: 24, fontWeight: "bold", textColor: "#111827" }),
  bodyFont: normalizeFont(section.bodyFont || {}, fallback.bodyFont || defaultFont),
});

const normalizeButton = (button = {}, fallback = {}) => ({
  text: String(button.text ?? fallback.text ?? ""),
  link: String(button.link ?? fallback.link ?? "/"),
  enabled: button.enabled !== false,
  font: normalizeFont(button.font || {}, fallback.font || { ...defaultFont, fontWeight: "bold", textColor: "#111827" }),
});

const normalizeImage = (image = {}, fallback = {}) => ({
  url: String(image.url ?? fallback.url ?? ""),
  enabled: image.enabled !== false,
});

const getOrCreateAboutPage = async () => {
  let page = await AboutPage.findOne({ key: "about" });
  if (!page) {
    page = await AboutPage.create({ key: "about" });
  }
  return page;
};

export const GetAboutPage = async (req, res) => {
  try {
    const page = await getOrCreateAboutPage();
    return res.json({ success: true, data: page });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const UpdateAboutPage = async (req, res) => {
  try {
    const current = await getOrCreateAboutPage();
    const payload = req.body || {};

    current.heroImage = normalizeImage(payload.heroImage, current.heroImage);
    current.secondaryImage = normalizeImage(payload.secondaryImage, current.secondaryImage);
    current.title = normalizeTextBlock(payload.title, current.title);
    current.intro = normalizeTextBlock(payload.intro, current.intro);
    current.primaryButton = normalizeButton(payload.primaryButton, current.primaryButton);
    current.secondaryButton = normalizeButton(payload.secondaryButton, current.secondaryButton);
    current.sections = Array.isArray(payload.sections)
      ? payload.sections.map((section, index) => normalizeSection(section, current.sections?.[index]))
      : current.sections;
    current.processSteps = Array.isArray(payload.processSteps)
      ? payload.processSteps.map((section, index) => normalizeSection(section, current.processSteps?.[index]))
      : current.processSteps;
    current.qualityPoints = Array.isArray(payload.qualityPoints)
      ? payload.qualityPoints.map((point, index) => normalizeTextBlock(point, current.qualityPoints?.[index]))
      : current.qualityPoints;
    current.lastEditedByAdminId = req.user?.id;

    await current.save();

    await createAuditLog({
      req,
      action: "UPDATE_ABOUT_PAGE",
      targetType: "AboutPage",
      targetId: current._id,
      targetName: "About Us",
      description: "Updated About Us page content",
    });

    return res.json({ success: true, data: current });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
