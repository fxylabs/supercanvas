import { assertId, assertSchemaVersion, fail, readCanvasJson, sourceHash } from "./protocol.mjs";

export const DEFAULT_RULES_SOURCE = "../_shared/rules.json";

function rulesFail(message, scope) {
  fail(scope || "rules", message);
}

export function prepareRules(data, scope = "rules") {
  if (!data) return null;
  assertSchemaVersion(data.schemaVersion, "rules", scope);
  if (!Number.isInteger(data.rulesRevision) || data.rulesRevision < 1) rulesFail("rulesRevision must be an integer greater than 0", scope);
  if (!["workspace", "project", "canvas"].includes(data.scope)) rulesFail("scope must be workspace, project or canvas", scope);
  if (!Array.isArray(data.rules)) rulesFail("rules must be an array", scope);

  const ids = new Set();
  const rules = data.rules.map((rule, index) => {
    assertId(rule.id, `rules[${index}].id`, scope);
    if (ids.has(rule.id)) rulesFail(`duplicate rule id: ${rule.id}`, scope);
    ids.add(rule.id);
    if (typeof rule.title !== "string" || !rule.title.trim()) rulesFail(`rules[${index}].title is required`, scope);
    if (!["active", "proposed", "deprecated"].includes(rule.status)) rulesFail(`rules[${index}].status must be active, proposed or deprecated`, scope);
    if (!["must", "should"].includes(rule.priority)) rulesFail(`rules[${index}].priority must be must or should`, scope);
    if (typeof rule.category !== "string" || !/^[a-z][a-z0-9-]*$/.test(rule.category)) rulesFail(`rules[${index}].category is invalid`, scope);
    if (typeof rule.statement !== "string" || !rule.statement.trim()) rulesFail(`rules[${index}].statement is required`, scope);
    if (rule.rationale != null && typeof rule.rationale !== "string") rulesFail(`rules[${index}].rationale must be a string`, scope);
    if (!Array.isArray(rule.appliesTo) || !rule.appliesTo.length || rule.appliesTo.some((value) => typeof value !== "string" || !value.trim())) {
      rulesFail(`rules[${index}].appliesTo must be a non-empty string array`, scope);
    }
    if (!rule.source || !["user-instruction", "feedback", "agent-proposal", "maintainer"].includes(rule.source.type)) {
      rulesFail(`rules[${index}].source.type is invalid`, scope);
    }
    if (rule.source.ref != null && typeof rule.source.ref !== "string") rulesFail(`rules[${index}].source.ref must be a string`, scope);
    if (!rule.verification || !["agent-checklist", "automated"].includes(rule.verification.type)) {
      rulesFail(`rules[${index}].verification.type is invalid`, scope);
    }
    if (!Array.isArray(rule.verification.checks) || !rule.verification.checks.length || rule.verification.checks.some((value) => typeof value !== "string" || !value.trim())) {
      rulesFail(`rules[${index}].verification.checks must be a non-empty string array`, scope);
    }
    return {
      ...rule,
      title: rule.title.trim(),
      statement: rule.statement.trim(),
      rationale: rule.rationale?.trim() || "",
      appliesTo: [...new Set(rule.appliesTo.map((value) => value.trim()))],
      verification: { ...rule.verification, checks: rule.verification.checks.map((value) => value.trim()) }
    };
  });

  return {
    schemaVersion: 2,
    rulesRevision: data.rulesRevision,
    scope: data.scope,
    title: typeof data.title === "string" && data.title.trim() ? data.title.trim() : "Canvas Common Rules",
    description: typeof data.description === "string" ? data.description.trim() : "",
    rules
  };
}

export async function loadRules(root, sourceRef, scope = "rules") {
  const source = sourceRef || DEFAULT_RULES_SOURCE;
  const data = await readCanvasJson(root, source, "sources.rules", null, scope, { optional: !sourceRef });
  return { source: data ? source : null, value: prepareRules(data, scope) };
}

export function ruleHashes(rules) {
  return Object.fromEntries((rules?.rules || []).map((rule) => [rule.id, sourceHash([rule])]));
}

export function activeRules(rules) {
  return (rules?.rules || []).filter((rule) => rule.status === "active");
}

export function proposedRules(rules) {
  return (rules?.rules || []).filter((rule) => rule.status === "proposed");
}
