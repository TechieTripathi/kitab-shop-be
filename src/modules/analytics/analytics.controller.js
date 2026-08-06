import PageViewModel from "../../model/pageview.model.js";
import DailyTraffic from "./DailyTraffic.model.js";
import SearchAnalytics from "./SearchAnalytics.model.js";
import NotificationEvent from "../../model/NotificationEvent.model.js";

const escapeCsv = (value) => {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const TrackPageView = async (req, res) => {
  try {
    const { path, name } = req.body;

    if (!path || !name) {
      return res.status(400).json({
        success: false,
        message: "Path and name are required",
      });
    }

    // Upsert the page view: increment viewCount if it exists, otherwise create it with viewCount: 1
    const pageView = await PageViewModel.findOneAndUpdate(
      { path },
      {
        $setOnInsert: { name },
        $inc: { viewCount: 1 },
      },
      { new: true, upsert: true, returnDocument: 'after' }
    );

    return res.status(200).json({
      success: true,
      message: "Page view tracked successfully",
      data: pageView,
    });
  } catch (error) {
    console.error("Error in TrackPageView:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while tracking page view",
    });
  }
};

export const GetPageViews = async (req, res) => {
  try {
    const pageViews = await PageViewModel.find().sort({ viewCount: -1 });

    return res.status(200).json({
      success: true,
      message: "Page views fetched successfully",
      data: pageViews,
    });
  } catch (error) {
    console.error("Error in GetPageViews:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching page views",
    });
  }
};

export const TrackVisitor = async (req, res) => {
  try {
    const { type } = req.body; // "new" or "returning"
    const date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    let update = { $inc: { totalUsers: 1 } };
    if (type === "new") {
      update.$inc.newUsers = 1;
    } else if (type === "returning") {
      update.$inc.returningUsers = 1;
    }

    const traffic = await DailyTraffic.findOneAndUpdate({ date }, update, {
      returnDocument: "after",
      upsert: true,
    });

    return res.status(200).json({
      success: true,
      message: "Visitor tracked successfully",
      data: traffic,
    });
  } catch (error) {
    console.error("Error in TrackVisitor:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while tracking visitor",
    });
  }
};

export const GetDailyTraffic = async (req, res) => {
  try {
    // Get traffic for the last 30 days
    const traffic = await DailyTraffic.find().sort({ date: -1 }).limit(30);

    return res.status(200).json({
      success: true,
      message: "Daily traffic fetched successfully",
      data: traffic.reverse(), // Return chronological order
    });
  } catch (error) {
    console.error("Error in GetDailyTraffic:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching daily traffic",
    });
  }
};

export const GetSearchAnalytics = async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [topQueries, zeroResultQueries, clicks, searchesByDay] = await Promise.all([
      SearchAnalytics.aggregate([
        { $match: { createdAt: { $gte: since }, source: { $in: ["search_page", "autocomplete"] } } },
        {
          $group: {
            _id: "$normalizedQuery",
            query: { $last: "$query" },
            count: { $sum: 1 },
            averageResults: { $avg: "$resultCount" },
            lastSearchedAt: { $max: "$createdAt" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]),
      SearchAnalytics.aggregate([
        { $match: { createdAt: { $gte: since }, resultCount: 0 } },
        {
          $group: {
            _id: "$normalizedQuery",
            query: { $last: "$query" },
            count: { $sum: 1 },
            lastSearchedAt: { $max: "$createdAt" },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 50 },
      ]),
      SearchAnalytics.aggregate([
        { $match: { createdAt: { $gte: since }, source: "suggestion_click" } },
        {
          $group: {
            _id: "$clickedProduct",
            clicks: { $sum: 1 },
            query: { $last: "$query" },
          },
        },
        {
          $lookup: {
            from: "products",
            localField: "_id",
            foreignField: "_id",
            as: "product",
          },
        },
        { $unwind: { path: "$product", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            productId: "$_id",
            productName: "$product.name",
            query: 1,
            clicks: 1,
          },
        },
        { $sort: { clicks: -1 } },
        { $limit: 50 },
      ]),
      SearchAnalytics.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$createdAt",
                timezone: "Asia/Kolkata",
              },
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        topQueries,
        zeroResultQueries,
        clicks,
        searchesByDay,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const ExportSearchAnalytics = async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const events = await SearchAnalytics.find({ createdAt: { $gte: since } })
      .populate("clickedProduct", "name")
      .sort({ createdAt: -1 })
      .limit(10000)
      .lean();
    const rows = [
      ["createdAt", "query", "source", "resultCount", "clickedProduct"],
      ...events.map((event) => [
        event.createdAt?.toISOString?.() || "",
        event.query,
        event.source,
        event.resultCount,
        event.clickedProduct?.name || "",
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="search-analytics.csv"');
    return res.status(200).send(csv);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const GetNotificationEvents = async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const filter = {};
    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;
    if (req.query.event && req.query.event !== "all") filter.event = req.query.event;

    const events = await NotificationEvent.find(filter)
      .populate("user", "email")
      .populate("order", "orderStatus totalAmount")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({ success: true, data: events });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
