# Elementary Circuit Components
#
# The three Phase 0 components: RenameField, AddField, DropField.
# Each is a thin wrapper around a panproto protolens elementary constructor.

{
  components = [
    {
      id = "circuit.component.rename_field",
      name = "RenameField",
      description = "Rename a field (vertex) in the schema. Lossless — classified as Iso.",
      category = "structure",
      optic = "iso",
      color = "#4CAF50",
      ports = {
        input = { direction = "input", trigger = "hot" },
        output = { direction = "output", trigger = "hot" },
        param = { direction = "parameter", trigger = "cold" },
      },
      parameters = {
        old_name = { type = "string", label = "Current Name", required = true },
        new_name = { type = "string", label = "New Name", required = true },
      },
      # Maps to: panproto_lens::protolens::elementary::rename_sort(old, new)
    },
    {
      id = "circuit.component.add_field",
      name = "AddField",
      description = "Add a field with a default value. Complement captures the default for backward pass.",
      category = "structure",
      optic = "lens",
      color = "#2196F3",
      ports = {
        input = { direction = "input", trigger = "hot" },
        output = { direction = "output", trigger = "hot" },
        param = { direction = "parameter", trigger = "cold" },
      },
      parameters = {
        field_name = { type = "string", label = "Field Name", required = true },
        field_kind = { type = "string", label = "Field Kind", required = true, default = "string" },
        default = { type = "any", label = "Default Value", required = true, default = "" },
      },
      # Maps to: panproto_lens::protolens::combinators::add_field(parent, name, kind, default)
    },
    {
      id = "circuit.component.drop_field",
      name = "DropField",
      description = "Remove a field. Complement stores the dropped data for backward restoration.",
      category = "structure",
      optic = "lens",
      color = "#2196F3",
      ports = {
        input = { direction = "input", trigger = "hot" },
        output = { direction = "output", trigger = "hot" },
        param = { direction = "parameter", trigger = "cold" },
      },
      parameters = {
        field_name = { type = "string", label = "Field Name", required = true },
      },
      # Maps to: panproto_lens::protolens::combinators::remove_field(name)
    },
  ],
}
