import Season from "./Season.model.js";

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

const normalizeSeason = (season) => ({
  id: season.slug,
  name: season.name,
  start: { month: season.startMonth - 1, day: season.startDay },
  end: { month: season.endMonth - 1, day: season.endDay },
  subtitle: `Custom ${season.name} collection`,
  custom: true,
});

export const GetCustomSeasons = async (_req, res) => {
  try {
    const seasons = await Season.find({ active: true }).sort({ name: 1 }).lean();
    return res.status(200).json({
      success: true,
      data: seasons.map(normalizeSeason),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const CreateCustomSeason = async (req, res) => {
  try {
    const { name, startMonth, startDay, endMonth, endDay } = req.body || {};
    const seasonName = String(name || "").trim();
    const startMonthNumber = toNumber(startMonth);
    const startDayNumber = toNumber(startDay);
    const endMonthNumber = toNumber(endMonth);
    const endDayNumber = toNumber(endDay);

    if (!seasonName) {
      return res.status(400).json({ success: false, message: "Season name is required" });
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

    const baseSlug = slugify(seasonName);
    if (!baseSlug) {
      return res.status(400).json({ success: false, message: "Season name is invalid" });
    }

    const season = await Season.create({
      name: seasonName,
      slug: `custom-${baseSlug}`,
      startMonth: startMonthNumber,
      startDay: startDayNumber,
      endMonth: endMonthNumber,
      endDay: endDayNumber,
    });

    return res.status(201).json({
      success: true,
      message: "Season created successfully",
      data: normalizeSeason(season),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A season with this name already exists",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const UpdateCustomSeason = async (req, res) => {
  try {
    const { slug } = req.params;
    const { name, startMonth, startDay, endMonth, endDay } = req.body || {};
    const seasonName = String(name || "").trim();
    const startMonthNumber = toNumber(startMonth);
    const startDayNumber = toNumber(startDay);
    const endMonthNumber = toNumber(endMonth);
    const endDayNumber = toNumber(endDay);

    if (!seasonName) {
      return res.status(400).json({ success: false, message: "Season name is required" });
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

    const season = await Season.findOneAndUpdate(
      { slug, active: true },
      {
        name: seasonName,
        startMonth: startMonthNumber,
        startDay: startDayNumber,
        endMonth: endMonthNumber,
        endDay: endDayNumber,
      },
      { returnDocument: "after", runValidators: true },
    );

    if (!season) {
      return res.status(404).json({ success: false, message: "Season not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Season updated successfully",
      data: normalizeSeason(season),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "A season with this name already exists",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const DeleteCustomSeason = async (req, res) => {
  try {
    const { slug } = req.params;
    const season = await Season.findOneAndUpdate(
      { slug, active: true },
      { active: false },
      { returnDocument: "after" },
    );

    if (!season) {
      return res.status(404).json({ success: false, message: "Season not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Season deleted successfully",
      data: normalizeSeason(season),
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
