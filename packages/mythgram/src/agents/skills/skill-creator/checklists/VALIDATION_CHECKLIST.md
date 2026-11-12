# Skill Validation Checklist

## Metadata and structure
- [ ] Skill folder name is lowercase kebab-case.
- [ ] Frontmatter is present and delimited by `---`.
- [ ] `name` matches the folder name.
- [ ] `description` states capability and activation conditions.
- [ ] Only supported metadata fields are used.
- [ ] `SKILL.md` is at the skill root.
- [ ] Every referenced relative file exists.

## Discoverability and scope
- [ ] Activation conditions are specific.
- [ ] Important user phrasings and synonyms are covered naturally.
- [ ] Non-trigger cases are stated where confusion is likely.
- [ ] The skill has one coherent job rather than an unrelated bundle of jobs.

## Operational quality
- [ ] Inputs and prerequisites are identified.
- [ ] Workflow steps are ordered and executable.
- [ ] Decision rules resolve common branches.
- [ ] Output format and acceptance criteria are explicit.
- [ ] Missing information and tool failures have defined behavior.
- [ ] Examples agree with the instructions.
- [ ] No vague commands such as "do it perfectly" substitute for real procedure.

## Safety and permissions
- [ ] Sensitive data is handled minimally.
- [ ] External or consequential actions have approval boundaries.
- [ ] Untrusted content cannot override higher-priority instructions.
- [ ] The skill does not request secrets unnecessarily.
- [ ] Prohibited or high-risk behavior is bounded.
- [ ] The skill does not claim permissions or capabilities it cannot grant.

## Maintainability and delivery
- [ ] Repetition and filler are removed.
- [ ] Supporting files add real value.
- [ ] Scripts document dependencies and usage.
- [ ] No secrets or irrelevant files are packaged.
- [ ] Validation claims accurately describe checks performed.
- [ ] Platform-specific assumptions and remaining checks are disclosed.
