import bcrypt from "bcrypt";
import crypto from "crypto";

import dotenv from "dotenv";

dotenv.config();

export const CreateHashPassword = (password) => {
  const hrms = crypto.createHmac("sha256", process.env.SECRET_KEY);

  hrms.update(password);
  return hrms.digest("hex");
};

export const CreateharhPassword = async (password) => {
  const pass = CreateHashPassword(password);
  const haredpassword = await bcrypt.hash(pass, 10);

  return haredpassword;
};

export const VerfiyPaswword = async (password, haredpassword) => {
  const pass = CreateHashPassword(password);
  return await bcrypt.compare(pass, haredpassword);
};

// export default { CreateharhPassword };

// const VerfilyPassword
