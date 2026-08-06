import UserProfile from "./UserProfile.model.js";

import { deleteImageAsset, saveImageAsset } from "../../utils/image-upload.js";

const VALID_GENDERS = new Set(["Male", "Female", "Other"]);

const clean = (value) => (typeof value === "string" ? value.trim() : value);

const buildNameFields = (body = {}) => {
  const sourceFullName = clean(body.fullName || body.name || "");
  const parts = sourceFullName ? sourceFullName.split(/\s+/).filter(Boolean) : [];
  const firstName = clean(body.firstName) || parts[0] || "";
  const middleName = body.middleName !== undefined ? clean(body.middleName) || "" : "";
  const lastName =
    clean(body.lastName) || (parts.length > 1 ? parts.slice(1).join(" ") : "");
  const fullName =
    sourceFullName || [firstName, middleName, lastName].filter(Boolean).join(" ");

  const updates = {};
  if (fullName) updates.fullName = fullName;
  if (firstName) updates.firstName = firstName;
  if (body.middleName !== undefined) updates.middleName = middleName;
  if (lastName) updates.lastName = lastName;

  return updates;
};

const collectProfileUpdates = (body = {}) => {
  const updates = {
    ...buildNameFields(body),
  };

  const phoneNumber = clean(body.phoneNumber || body.phone);
  if (phoneNumber) updates.phoneNumber = phoneNumber;
  if (body.dob) updates.dob = body.dob;
  if (body.bio !== undefined) updates.bio = clean(body.bio) || "";
  if (body.gender && VALID_GENDERS.has(body.gender)) updates.gender = body.gender;

  const addressLine1 = clean(body.addressLine1 || body.address || body.line);
  if (addressLine1) updates["address.addressLine1"] = addressLine1;
  if (body.addressLine2 !== undefined) {
    updates["address.addressLine2"] = clean(body.addressLine2) || "";
  }
  if (body.city) updates["address.city"] = clean(body.city);
  if (body.state) updates["address.state"] = clean(body.state);
  if (body.pincode) updates["address.pincode"] = clean(body.pincode);
  if (body.country) updates["address.country"] = clean(body.country);

  return updates;
};

const saveAvatar = async (file, userId) => {
  if (!file) return "";

  return saveImageAsset({
    file,
    folder: "profiles",
    name: `profile-${userId}`,
    width: 500,
    height: 500,
    quality: 80,
  });
};

const attachAvatarUpdate = async (updates, file, userId) => {
  if (!file) return;

  const existingProfile = await UserProfile
    .findOne({ userid: userId })
    .select("avatarPublicId");
  const avatarResult = await saveAvatar(file, userId);

  await deleteImageAsset(existingProfile?.avatarPublicId);

  updates.avatar = avatarResult.image;
  updates.avatarPublicId = avatarResult.public_id || "";
};

const attachIsFilled = (profile) => {
  if (!profile) return null;

  const data = profile.toObject ? profile.toObject() : profile;
  const address = data.address || {};
  const isFilled = Boolean(
    (data.fullName || data.firstName) &&
      data.phoneNumber &&
      address.addressLine1 &&
      address.city &&
      address.state &&
      address.pincode,
  );

  return { ...data, isFilled };
};

export const UserProfileController = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = collectProfileUpdates(req.body);
    await attachAvatarUpdate(updates, req.file, userId);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "No profile details provided",
      });
    }

    const profile = await UserProfile.findOneAndUpdate(
      { userid: userId },
      {
        $set: { userid: userId, ...updates },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return res.status(201).json({
      message: "Profile created successfully",
      data: attachIsFilled(profile),
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const GetProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(400).json({
        message: "UserId is required",
      });
    }

    // Find profile in MongoDB
    const profile = await UserProfile.findOne({
      userid: userId,
    });

    // if (!profile) {
    //   return res.status(404).json({
    //     message: "Profile not found",
    //   });
    // }

    if (!profile) {
      return res.status(200).json({
        success: true,
        message: "Profile not created yet",
        data: null,
      });
    }

    return res.status(200).json({
      message: "Profile fetched successfully",
      data: attachIsFilled(profile),
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const UpdateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const updates = collectProfileUpdates(req.body);
    await attachAvatarUpdate(updates, req.file, userId);

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "No fields provided for update",
      });
    }

    const updatedProfile = await UserProfile.findOneAndUpdate(
      { userid: userId },
      { $set: { userid: userId, ...updates } },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return res.status(200).json({
      message: "Profile updated successfully",
      data: attachIsFilled(updatedProfile),
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};
export const SingleFieldProfileUpdate = async (req, res) => {
  try {
    const userId = req.user.id;

    const updates = collectProfileUpdates(req.body);

    // 2. Handle image upload
    await attachAvatarUpdate(updates, req.file, userId);

    // 3. Prevent empty update
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        message: "No fields provided for update",
      });
    }

    // 4. Update MongoDB
    const updatedProfile = await UserProfile.findOneAndUpdate(
      { userid: userId },
      { $set: { userid: userId, ...updates } },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      },
    );

    return res.status(200).json({
      message: "Profile updated successfully",
      data: attachIsFilled(updatedProfile),
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      message: error.message,
    });
  }
};

export const GetReferralStats = async (req, res) => {
  try {
    const userId = req.user.id;

    if (!userId) {
      return res.status(400).json({
        message: "UserId is required",
      });
    }

    const profile = await UserProfile.findOne({ userid: userId });

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Profile not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        referralCode: profile.referralCode || "",
        totalReferrals: profile.totalReferrals || 0,
        totalWalletCreditEarned: profile.totalWalletCreditEarned || 0,
        walletBalance: profile.walletBalance || 0,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
