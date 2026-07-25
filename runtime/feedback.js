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

  function reconcile(canonical, draft, targetHashes, meta) {
    var envelope = draft || {};
    var review = meta && meta.review;
    if (review && envelope.reviewId && envelope.reviewId !== review.id) envelope = {};
    if (envelope.submittedAt && Number(envelope.baseFeedbackRevision || 0) < Number(meta && meta.feedbackRevision || 0)) envelope = {};
    var deleted = new Set(envelope.deletedIds || []);
    var merged = new Map();
    (canonical || []).forEach(function (comment) { if (!deleted.has(comment.id)) merged.set(comment.id, comment); });
    (envelope.comments || []).forEach(function (comment) { if (!deleted.has(comment.id)) merged.set(comment.id, comment); });
    return Array.from(merged.values()).map(function (comment) {
      return Object.assign({}, comment, { reviewState: reviewState(comment, targetHashes) });
    });
  }

  function validateMessage(message) {
    if (!message || typeof message.id !== "string" || typeof message.text !== "string" || !message.text.trim()) throw new Error("유효하지 않은 thread message가 있습니다.");
    if (!message.author || !["user", "agent"].includes(message.author.type) || typeof message.author.label !== "string") throw new Error("thread message author가 유효하지 않습니다.");
    if (typeof message.createdAt !== "string" || !message.createdAt) throw new Error("thread message createdAt이 필요합니다.");
  }

  function validateComment(comment, ids) {
    if (!comment || typeof comment.id !== "string" || ids.has(comment.id)) throw new Error("중복되거나 유효하지 않은 comment ID가 있습니다.");
    ids.add(comment.id);
    if (!comment.target || typeof comment.target.id !== "string" || typeof comment.target.type !== "string") throw new Error("유효하지 않은 comment target이 있습니다.");
    var anchor = comment.target.anchor;
    if (anchor) {
      if (comment.target.type !== "frame" || !["point", "region"].includes(anchor.kind)) throw new Error("유효하지 않은 comment anchor가 있습니다.");
      if (![anchor.x, anchor.y].every(function (value) { return Number.isFinite(value) && value >= 0 && value <= 100; })) throw new Error("comment anchor 좌표가 Frame 범위를 벗어납니다.");
      if (anchor.kind === "region") {
        if (![anchor.width, anchor.height].every(function (value) { return Number.isFinite(value) && value > 0 && value <= 100; })) throw new Error("comment region 크기가 유효하지 않습니다.");
        if (anchor.x + anchor.width > 100.1 || anchor.y + anchor.height > 100.1) throw new Error("comment region이 Frame 범위를 벗어납니다.");
      }
    }
    if (!["open", "discussion", "resolved"].includes(comment.status)) throw new Error("comment status는 open, discussion 또는 resolved여야 합니다.");
    if (typeof comment.text !== "string" || !comment.text.trim()) throw new Error("comment text가 필요합니다.");
    var messageIds = new Set();
    (comment.thread || []).forEach(function (message) {
      validateMessage(message);
      if (messageIds.has(message.id)) throw new Error("중복된 thread message ID가 있습니다.");
      messageIds.add(message.id);
    });
    if (comment.status === "discussion" && !(comment.thread || []).some(function (message) { return message.author.type === "agent"; })) throw new Error("discussion 댓글에는 Agent 질문이 필요합니다.");
    if (comment.resolution) {
      if (typeof comment.resolution.summary !== "string" || !comment.resolution.summary.trim()) throw new Error("resolution summary가 필요합니다.");
      if (comment.resolution.changes != null && !Array.isArray(comment.resolution.changes)) throw new Error("resolution changes는 배열이어야 합니다.");
    }
    if (comment.ruleProposal) {
      var proposal = comment.ruleProposal;
      if (!["proposed", "approved", "rejected"].includes(proposal.status)) throw new Error("ruleProposal status는 proposed, approved 또는 rejected여야 합니다.");
      if (typeof proposal.statement !== "string" || !proposal.statement.trim()) throw new Error("ruleProposal statement가 필요합니다.");
      if (typeof proposal.category !== "string" || !/^[a-z][a-z0-9-]*$/.test(proposal.category)) throw new Error("ruleProposal category가 유효하지 않습니다.");
      if (proposal.rationale != null && typeof proposal.rationale !== "string") throw new Error("ruleProposal rationale은 문자열이어야 합니다.");
    }
  }

  function validateEnvelope(payload, canvasId) {
    if (!payload || typeof payload !== "object") throw new Error("feedback JSON object가 필요합니다.");
    if (payload.canvasId !== canvasId) throw new Error("다른 Canvas의 feedback입니다.");
    if (!Array.isArray(payload.comments)) throw new Error("comments 배열이 없습니다.");
    if (payload.review && (typeof payload.review.id !== "string" || !["active", "completed"].includes(payload.review.status))) throw new Error("review cycle이 유효하지 않습니다.");
    if (payload.feedbackRevision != null && (!Number.isInteger(payload.feedbackRevision) || payload.feedbackRevision < 1)) throw new Error("feedbackRevision은 1 이상의 정수여야 합니다.");
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
    portable: portable,
    reconcile: reconcile,
    reviewState: reviewState,
    stripDerived: stripDerived,
    validateEnvelope: validateEnvelope,
    validatePortable: validatePortable
  };
})(typeof window !== "undefined" ? window : this);
