import Festival from "./Festival.model.js";

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
    const { name, startMonth, startDay, endMonth, endDay, countdownFrom } = req.body || {};
    const festivalName = String(name || "").trim();
    const startMonthNumber = toNumber(startMonth);
    const startDayNumber = toNumber(startDay);
    const endMonthNumber = toNumber(endMonth);
    const endDayNumber = toNumber(endDay);
    const countdownNumber = toNumber(countdownFrom);

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
    const { name, startMonth, startDay, endMonth, endDay, countdownFrom } = req.body || {};
    const festivalName = String(name || "").trim();
    const startMonthNumber = toNumber(startMonth);
    const startDayNumber = toNumber(startDay);
    const endMonthNumber = toNumber(endMonth);
    const endDayNumber = toNumber(endDay);
    const countdownNumber = toNumber(countdownFrom);

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

    const festival = await Festival.findOneAndUpdate(
      { slug, active: true },
      {
        name: festivalName,
        startMonth: startMonthNumber,
        startDay: startDayNumber,
        endMonth: endMonthNumber,
        endDay: endDayNumber,
        countdownFrom: countdownNumber === null ? 7 : countdownNumber,
      },
      { new: true, runValidators: true },
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
      { new: true },
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
