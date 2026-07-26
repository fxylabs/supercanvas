/* Portable feedback protocol shared by the standalone Canvas runtime and verification. */
(function (global) {
  "use strict";

  function stripDerived(comment) {
    var copy = Object.assign({}, comment);
    delete copy.reviewState;
    return copy;
  }

  function reviewState(comment, targetHashes) {
    var current = targetHashes && comment.target && targetHashes[comment.target.id];
    if (!comment.targetRevision) return "unbound";
    return comment.targetRevision === current ? "current" : "outdated";
  }

  function archivedCommentIds(archive) {
    var ids = [];
    (archive || []).forEach(function (entry) { (entry.comments || []).forEach(function (comment) { ids.push(comment.id); }); });
    return ids;
  }

  function reconcile(canonical, draft, targetHashes, meta) {
    var envelope = draft || {};
    var review = meta && meta.review;
    if (review && envelope.reviewId && envelope.reviewId !== review.id) envelope = {};
    if (envelope.submittedAt && Number(envelope.baseFeedbackRevision || 0) < Number(meta && meta.feedbackRevision || 0)) envelope = {};
    var deleted = new Set(envelope.deletedIds || []);
    var archived = new Set((meta && meta.archivedIds) || []);
    var merged = new Map();
    (canonical || []).forEach(function (comment) { if (!deleted.has(comment.id) && !archived.has(comment.id)) merged.set(comment.id, comment); });
    (envelope.comments || []).forEach(function (comment) { if (!deleted.has(comment.id) && !archived.has(comment.id)) merged.set(comment.id, comment); });
    return Array.from(merged.values()).map(function (comment) {
      return Object.assign({}, comment, { reviewState: reviewState(comment, targetHashes) });
    });
  }

  function validateMessage(message) {
    if (!message || typeof message.id !== "string" || typeof message.text !== "string" || !message.text.trim()) throw new Error("Invalid thread message.");
    if (!message.author || !["user", "agent"].includes(message.author.type) || typeof message.author.label !== "string") throw new Error("Invalid thread message author.");
    if (typeof message.createdAt !== "string" || !message.createdAt) throw new Error("thread message createdAt is required.");
  }

  function validateComment(comment, ids) {
    if (!comment || typeof comment.id !== "string" || ids.has(comment.id)) throw new Error("Duplicate or invalid comment ID.");
    ids.add(comment.id);
    if (!comment.target || typeof comment.target.id !== "string" || typeof comment.target.type !== "string") throw new Error("Invalid comment target.");
    var anchor = comment.target.anchor;
    if (anchor) {
      if (comment.target.type !== "frame" || !["point", "region"].includes(anchor.kind)) throw new Error("Invalid comment anchor.");
      if (![anchor.x, anchor.y].every(function (value) { return Number.isFinite(value) && value >= 0 && value <= 100; })) throw new Error("comment anchor coordinates fall outside the frame.");
      if (anchor.kind === "region") {
        if (![anchor.width, anchor.height].every(function (value) { return Number.isFinite(value) && value > 0 && value <= 100; })) throw new Error("Invalid comment region size.");
        if (anchor.x + anchor.width > 100.1 || anchor.y + anchor.height > 100.1) throw new Error("comment region falls outside the frame.");
      }
    }
    if (!["open", "discussion", "resolved"].includes(comment.status)) throw new Error("comment status must be open, discussion or resolved.");
    if (typeof comment.text !== "string" || !comment.text.trim()) throw new Error("comment text is required.");
    var messageIds = new Set();
    (comment.thread || []).forEach(function (message) {
      validateMessage(message);
      if (messageIds.has(message.id)) throw new Error("Duplicate thread message ID.");
      messageIds.add(message.id);
    });
    if (comment.status === "discussion" && !(comment.thread || []).some(function (message) { return message.author.type === "agent"; })) throw new Error("A discussion comment needs an agent question.");
    if (comment.resolution) {
      if (typeof comment.resolution.summary !== "string" || !comment.resolution.summary.trim()) throw new Error("resolution summary is required.");
      if (comment.resolution.changes != null && !Array.isArray(comment.resolution.changes)) throw new Error("resolution changes must be an array.");
    }
    if (comment.ruleProposal) {
      var proposal = comment.ruleProposal;
      if (!["proposed", "approved", "rejected"].includes(proposal.status)) throw new Error("ruleProposal status must be proposed, approved or rejected.");
      if (typeof proposal.statement !== "string" || !proposal.statement.trim()) throw new Error("ruleProposal statement is required.");
      if (typeof proposal.category !== "string" || !/^[a-z][a-z0-9-]*$/.test(proposal.category)) throw new Error("Invalid ruleProposal category.");
      if (proposal.rationale != null && typeof proposal.rationale !== "string") throw new Error("ruleProposal rationale must be a string.");
    }
  }

  function validateEnvelope(payload, canvasId) {
    if (!payload || typeof payload !== "object") throw new Error("A feedback JSON object is required.");
    if (payload.canvasId !== canvasId) throw new Error("This feedback belongs to a different canvas.");
    if (!Array.isArray(payload.comments)) throw new Error("Missing comments array.");
    if (payload.review && (typeof payload.review.id !== "string" || !["active", "completed"].includes(payload.review.status))) throw new Error("Invalid review cycle.");
    if (payload.feedbackRevision != null && (!Number.isInteger(payload.feedbackRevision) || payload.feedbackRevision < 1)) throw new Error("feedbackRevision must be an integer of 1 or more.");
    var ids = new Set();
    payload.comments.forEach(function (comment) { validateComment(comment, ids); });
    return Object.assign({}, payload, { comments: payload.comments.map(stripDerived) });
  }

  function validatePortable(payload, canvasId) {
    return validateEnvelope(payload, canvasId).comments;
  }

  function portable(meta, comments) {
    return {
      schemaVersion: 2,
      canvasId: meta.canvasId,
      canvasVersion: meta.canvasVersion,
      baseRevision: meta.baseRevision,
      feedbackRevision: meta.feedbackRevision || 1,
      review: meta.review || null,
      archive: meta.archive || [],
      comments: (comments || []).map(stripDerived)
    };
  }

  global.CanvasFeedback = {
    archivedCommentIds: archivedCommentIds,
    portable: portable,
    reconcile: reconcile,
    reviewState: reviewState,
    stripDerived: stripDerived,
    validateEnvelope: validateEnvelope,
    validatePortable: validatePortable
  };
})(typeof window !== "undefined" ? window : this);
