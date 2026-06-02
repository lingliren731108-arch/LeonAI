# Leon AI File Placement Decision Logic & Guidelines

## File Placement Decision Logic
When generating design documents, personas, PRDs, user flows, style guides, screens, or prototypes, place them in the following directories under `workspace/leon/`:

1. **Strategic Planning Documents**
   - **Product Charter**: `workspace/leon/Global Context/product_charter.md`
   - **User Persona(s)**: `workspace/leon/Global Context/user_persona.md` or `workspace/leon/Global Context/persona_[archetype].md` (e.g., `persona_power_user.md`, `persona_admin.md`)
   - Recommended Folder: `workspace/leon/Global Context/`

2. **Product Requirement Definitions**
   - **PRD (Product Requirements Document)**: `workspace/leon/Feature Plan/prd.md` or `workspace/leon/Feature Plan/prd_[feature_name].md`
   - **Screen & Wireframe Plan**: `workspace/leon/Feature Plan/screen_plan.md`
   - **User Flows / Flowcharts**: `workspace/leon/Feature Plan/user_flow.md`
   - Recommended Folder: `workspace/leon/Feature Plan/`

3. **Style Guides**
   - **Recommended Styles / CSS Guides**: `workspace/leon/Style Guide/style.md`
   - Recommended Folder: `workspace/leon/Style Guide/`

4. **Screens & Prototypes**
   - **HTML Screen Designs**: `workspace/leon/Screen & Prototype/[screen_name].html` (e.g., `home.html`, `dashboard.html`)
   - **Interactive Prototype**: `workspace/leon/Screen & Prototype/app.prototype.html` or `workspace/leon/Screen & Prototype/[project_name].prototype.html`
   - Recommended Folder: `workspace/leon/Screen & Prototype/`

## Tool Usage Order for Document Generation
1. Read the matching template from the `prompts/` directory (e.g., `prompts/gen-product-charter.md` for Product Charter).
2. Generate the document content conforming to the template.
3. Write the document to its designated location under `workspace/leon/` using the `write_workspace_file` tool.
4. If writing a screen design, call the `generate_screen` tool instead.
