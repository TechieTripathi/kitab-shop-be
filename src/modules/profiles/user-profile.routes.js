import expres from "express";

import image from "../../middleware/image.middleware.js";
import {
  GetProfile,
  UserProfileController,
  SingleFieldProfileUpdate,
  UpdateProfile,
  GetReferralStats,
  GetAddresses,
  AddAddress,
  UpdateAddress,
  DeleteAddress,
  SetDefaultAddress,
} from "./profile.controller.js";
import { TokenVerify } from "../../middleware/auth.middleware.js";

const routes = expres.Router();

//    post profile

routes.post(
  "/create",
  TokenVerify,
  image.single("User_image"),
  UserProfileController,
);

//  get profile

routes.get("/get-profile", TokenVerify, GetProfile);

//  put profile / patch

routes.put(
  "/update-profile",
  TokenVerify,
  image.single("User_image"),
  UpdateProfile,
);

routes.patch(
  "/update-profile",
  TokenVerify,
  image.single("User_image"),
  SingleFieldProfileUpdate,
);

routes.get("/referral-stats", TokenVerify, GetReferralStats);

//  saved address book

routes.get("/addresses", TokenVerify, GetAddresses);
routes.post("/addresses", TokenVerify, AddAddress);
routes.put("/addresses/:addressId", TokenVerify, UpdateAddress);
routes.delete("/addresses/:addressId", TokenVerify, DeleteAddress);
routes.put("/addresses/:addressId/default", TokenVerify, SetDefaultAddress);

export default routes;
