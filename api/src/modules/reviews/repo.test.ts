import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-reviews-test-"));

const repo = await import("./repo.js");

test("review reward is locked once and completed together with publication", () => {
  const review = repo.createReview({
    userId: 42,
    userLogin: "user42",
    displayName: "User 42",
    rating: 5,
    text: "Хороший сервис и удобное приложение.",
  });

  assert.ok(review);
  assert.equal(review.status, "pending");
  assert.equal(review.reward_status, "none");
  assert.equal(repo.beginReviewReward(review.id), true);
  assert.equal(repo.beginReviewReward(review.id), false);
  assert.equal(repo.completeReviewReward(review.id, 300), true);

  const completed = repo.getReviewById(review.id);
  assert.equal(completed?.status, "published");
  assert.equal(completed?.reward_status, "rewarded");
  assert.equal(completed?.reward_amount, 300);
  assert.ok(completed?.rewarded_at);
  assert.equal(repo.beginReviewReward(review.id), false);
});

test("a confirmed billing failure can be retried while the review stays pending", () => {
  const review = repo.createReview({
    userId: 43,
    userLogin: "user43",
    displayName: "User 43",
    rating: 4,
    text: "Всё работает, оставляю подробный отзыв.",
  });

  assert.ok(review);
  assert.equal(repo.beginReviewReward(review.id), true);
  assert.equal(repo.failReviewReward(review.id, "bonus_not_added"), true);

  const failed = repo.getReviewById(review.id);
  assert.equal(failed?.status, "pending");
  assert.equal(failed?.reward_status, "failed");
  assert.equal(repo.beginReviewReward(review.id), true);
});

test("one account cannot create a second review", () => {
  const first = repo.createReview({
    userId: 44,
    userLogin: "user44",
    displayName: "User 44",
    rating: 5,
    text: "Первый и единственный отзыв этого аккаунта.",
  });

  assert.ok(first);
  assert.equal(repo.hasReviewByUserId(44), true);
  assert.throws(() => repo.createReview({
    userId: 44,
    userLogin: "user44",
    displayName: "User 44",
    rating: 4,
    text: "Повторный отзыв не должен быть сохранён.",
  }), /review_already_exists/);
});

test("a rejected unpaid review releases the account for a new review", () => {
  const rejected = repo.createReview({
    userId: 45,
    userLogin: "user45",
    displayName: "User 45",
    rating: 2,
    text: "Этот отзыв будет отклонён администратором.",
  });

  assert.ok(rejected);
  assert.equal(repo.beginReviewReward(rejected.id), true);
  assert.equal(repo.failReviewReward(rejected.id, "bonus_not_added"), true);
  assert.equal(repo.hideReview(rejected.id), true);
  assert.equal(repo.hasReviewByUserId(45), false);

  const replacement = repo.createReview({
    userId: 45,
    userLogin: "user45",
    displayName: "User 45",
    rating: 5,
    text: "Исправленный отзыв снова отправлен на проверку.",
  });
  assert.ok(replacement);
  assert.equal(repo.beginReviewReward(replacement.id), true);
});

test("removing a rewarded review does not unlock another rewarded submission", () => {
  const rewarded = repo.createReview({
    userId: 46,
    userLogin: "user46",
    displayName: "User 46",
    rating: 5,
    text: "Этот отзыв уже опубликован и получил награду.",
  });
  assert.ok(rewarded);
  assert.equal(repo.beginReviewReward(rewarded.id), true);
  assert.equal(repo.completeReviewReward(rewarded.id, 100), true);
  assert.equal(repo.hideReview(rewarded.id), true);
  assert.equal(repo.hasReviewByUserId(46), true);
  assert.throws(() => repo.createReview({
    userId: 46,
    userLogin: "user46",
    displayName: "User 46",
    rating: 5,
    text: "Повторная награда после удаления недоступна.",
  }), /review_already_exists/);
});
