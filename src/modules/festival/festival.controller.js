import Festival from "./Festival.model.js";

// Kept in sync with FESTIVAL_GRADIENT_PRESETS in
// kitab-shop-fe/src/features/admin-season-festival/seasonFestival.helpers.js —
// these are Tailwind class strings, and Tailwind only generates CSS for
// classes it can find literally in source, so admins pick from this fixed
// set rather than typing arbitrary gradient classes that would silently
// render with no background at all.
const ALLOWED_GRADIENTS = [
  "from-amber-500 via-orange-500 to-yellow-400",
  "from-pink-500 via-fuchsia-500 to-yellow-400",
  "from-slate-800 via-indigo-700 to-purple-700",
  "from-emerald-600 via-yellow-500 to-orange-400",
  "from-red-700 via-rose-600 to-amber-400",
  "from-emerald-600 via-green-500 to-red-500",
];

const slugify = (value = "") =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const isValidDay = (month, day) => {
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1];
};

const normalizeFestival = (festival) => ({
  id: festival.slug,
  name: festival.name,
  start: { month: festival.startMonth - 1, day: festival.startDay },
  end: { month: festival.endMonth - 1, day: festival.endDay },
  countdownFrom: festival.countdownFrom,
  banner: festival.banner || "",
  emoji: festival.emoji || "",
  gradient: festival.gradient || "",
  custom: true,
});

export const GetCustomFestivals = async (_req, res) => {
  try {
    const festivals = await Festival.find({ active: true }).sort({ name: 1 }).lean();
    return res.status(200).json({
      success: true,
      data: festivals.map(normalizeFestival),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const CreateCustomFestival = async (req, res) => {
  try {
    const { name, startMonth, startDay, endMonth, endDay, countdownFrom, banner, emoji, gradient } = req.body || {};
    const festivalName = String(name || "").trim();
    const startMonthNumber = toNumber(startMonth);
    const startDayNumber = toNumber(startDay);
    const endMonthNumber = toNumber(endMonth);
    const endDayNumber = toNumber(endDay);
    const countdownNumber = toNumber(countdownFrom);
    const gradientValue = String(gradient || "").trim();

    if (!festivalName) {
      return res.status(400).json({ success: false, message: "Festival name is required" });
    }

    if (
      !isValidDay(startMonthNumber, startDayNumber) ||
      !isValidDay(endMonthNumber, endDayNumber)
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid start and end date",
      });
    }

    if (gradientValue && !ALLOWED_GRADIENTS.includes(gradientValue)) {
      return res.status(400).json({ success: false, message: "Invalid banner color selected" });
    }

    const baseSlug = slugify(festivalName);
    if (!baseSlug) {
      return res.status(400).json({ success: false, message: "Festival name is invalid" });
    }

    const slug = `custom-${baseSlug}`;
    const festival = await Festival.create({
      name: festivalName,
      slug,
      startMonth: startMonthNumber,
      startDay: startDayNumber,
      endMonth: endMonthNumber,
      endDay: endDayNumber,
      countdownFrom: countdownNumber === null ? 7 : countdownNumber,
      banner: String(banner || "").trim(),
      emoji: String(emoji || "").trim(),
      gradient: gradientValue,
    });

    return res.status(201).json({
      success: true,
      message: "Festival created successfully",
      data: normalizeFestival(festival),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A festival with this name already exists",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const UpdateCustomFestival = async (req, res) => {
  try {
    const { slug } = req.params;
    const { name, startMonth, startDay, endMonth, endDay, countdownFrom, banner, emoji, gradient } = req.body || {};
    const festivalName = String(name || "").trim();
    const startMonthNumber = toNumber(startMonth);
    const startDayNumber = toNumber(startDay);
    const endMonthNumber = toNumber(endMonth);
    const endDayNumber = toNumber(endDay);
    const countdownNumber = toNumber(countdownFrom);
    const gradientValue = String(gradient || "").trim();

    if (!festivalName) {
      return res.status(400).json({ success: false, message: "Festival name is required" });
    }

    if (
      !isValidDay(startMonthNumber, startDayNumber) ||
      !isValidDay(endMonthNumber, endDayNumber)
    ) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid start and end date",
      });
    }

    if (gradientValue && !ALLOWED_GRADIENTS.includes(gradientValue)) {
      return res.status(400).json({ success: false, message: "Invalid banner color selected" });
    }

    const festival = await Festival.findOneAndUpdate(
      { slug, active: true },
      {
        name: festivalName,
        startMonth: startMonthNumber,
        startDay: startDayNumber,
        endMonth: endMonthNumber,
        endDay: endDayNumber,
        countdownFrom: countdownNumber === null ? 7 : countdownNumber,
        banner: String(banner || "").trim(),
        emoji: String(emoji || "").trim(),
        gradient: gradientValue,
      },
      { returnDocument: "after", runValidators: true },
    );

    if (!festival) {
      return res.status(404).json({ success: false, message: "Festival not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Festival updated successfully",
      data: normalizeFestival(festival),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A festival with this name already exists",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const DeleteCustomFestival = async (req, res) => {
  try {
    const { slug } = req.params;
    const festival = await Festival.findOneAndUpdate(
      { slug, active: true },
      { active: false },
      { returnDocument: "after" },
    );

    if (!festival) {
      return res.status(404).json({ success: false, message: "Festival not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Festival deleted successfully",
      data: normalizeFestival(festival),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
