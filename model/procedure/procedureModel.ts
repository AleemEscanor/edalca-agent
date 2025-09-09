import mongoose, { Schema, Document, Types } from "mongoose";

interface Condition {
  id: string;
  logic: string;
  selected: string[];
  nestedFields: FieldItem[];
}

interface FieldItem {
  id: string;
  type: "field" | "heading" | "section";

  // For heading
  heading?: string;

  // For section
  sectionName?: string;
  sectionDescription?: string;
  sectionFields?: FieldItem[];

  // For field
  fieldName?: string;
  description?: string;
  fieldType?: string;
  textFieldValue?: string;
  required?: boolean;
  showBranch?: boolean;
  conditions?: Condition[];
}

export interface ProcedureDocument extends Document {
  procedureId?: string;
  name: string;
  description: string;
  organizationId: Types.ObjectId;
  createdBy?: mongoose.Schema.Types.ObjectId;
  entityType?: string;
  items: FieldItem[];
}

const FieldItemSchema = new Schema<FieldItem>(
  {
    id: { type: String, required: true },
    type: {
      type: String,
      enum: ["field", "heading", "section"],
      required: true,
    },

    // Heading
    heading: { type: String },

    // Section
    sectionName: { type: String },
    sectionDescription: { type: String },
    sectionFields: [this], // recursive for fields inside sections

    // Field
    fieldName: { type: String },
    description: { type: String },
    fieldType: { type: String },
    textFieldValue: { type: String },
    required: { type: Boolean },
    showBranch: { type: Boolean },
    conditions: [
      new Schema<Condition>(
        {
          id: { type: String, required: true },
          logic: { type: String, required: true },
          selected: [String],
          nestedFields: [this], // recursive for nested field conditions
        },
        { _id: false }
      ),
    ],
  },
  { _id: false }
);

const ProcedureSchema = new Schema<ProcedureDocument>({
  procedureId: { type: String, unique: true, required: true },
  name: { type: String, required: true },
  description: { type: String, required: true },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Organization",
    required: true,
  },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  items: { type: [FieldItemSchema], default: [] },
},
{
    timestamps: true,
}
);

const Procedure = mongoose.model<ProcedureDocument>("Procedure", ProcedureSchema);
export default Procedure;
