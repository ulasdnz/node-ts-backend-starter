import mongoose, { type InferSchemaType, Types } from 'mongoose';
import { regexes } from 'zod';
import {
  type SoftDeleteModel,
  softDeletePlugin,
} from '../../database/plugins/softDelete.plugin.js';
const { Schema, model } = mongoose;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      match: regexes.email,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    name: {
      type: String,
      required: true,
    },
    surname: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ['admin', 'user'],
      default: 'user',
    },
    gender: {
      type: String,
      enum: ['male', 'female', 'other'],
    },
    countryCode: {
      type: String,
    },
    birthDate: {
      type: Date,
    },
    photoUrl: {
      type: String,
      default:
        'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Node.js_logo.svg/1200px-Node.js_logo.svg.png',
    },
    isActivated: {
      type: Boolean,
      default: true,
    },
    passwordChangedAt: Date,
  },
  {
    timestamps: true,
    strict: true,
  },
);

export type IUser = InferSchemaType<typeof userSchema> & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  deleted: boolean;
  deletedAt: Date | null;
  restore(): Promise<IUser>;
};

userSchema.plugin(softDeletePlugin);

const User = model<IUser, SoftDeleteModel<IUser>>('User', userSchema);
export default User;
