Where is persisted user data decoded against a schema, and what keeps data written by earlier app versions valid?

Find persisted stores, their schemas, version numbers and migrate functions, and
app/shared/lib/persist/createMergeWithSchema.ts. Removing or tightening a persisted value needs
tolerant decoding or a versioned migration, or existing users' data resets. Schemas for network or
clipboard input are not this question.
