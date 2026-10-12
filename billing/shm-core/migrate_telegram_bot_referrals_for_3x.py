#!/usr/bin/env python3
"""Move bot alias completion to native SHM state plus an authenticated app receipt.

SHM 3 pins bot-generated sessions to the webhook fingerprint. They cannot be
replayed by ShpunApp, even with a session cookie. No customer credentials are
stored in this transformation.
"""
import sys


def transform(source: str) -> str:
    newline = "\r\n" if "\r\n" in source else "\n"
    source = source.replace("\r\n", "\n")

    anchor = "    referralClaimUrl = appInternalApiUrl _ '/internal/referrals/telegram-claim';"
    assert source.count(anchor) == 1
    source = source.replace(anchor, "    referralClaimUrl = appInternalApiUrl _ '/internal/referrals/telegram-bot-claim';\n    referralClaimSecret = config.bot.referralClaimSecret || '';", 1)

    anchor = "    campaignPartnerId = '';"
    assert source.count(anchor) == 1
    source = source.replace(anchor, anchor + "\n    campaignFirstPayPercent = 0;\n    campaignLinkType = '';\n    campaignCommentConfirmed = 0;", 1)

    anchor = "            campaignPartnerId = resolveBody.partnerId || '';"
    assert source.count(anchor) == 1
    source = source.replace(anchor, anchor + "\n            campaignFirstPayPercent = resolveBody.firstPayPercent || 0;\n            campaignLinkType = resolveBody.linkType || '';", 1)

    old = """        IF campaignComment;
            # Never overwrite an existing billing comment (same rule as the
            # SHM referrals.claim template).
            IF !user.comment;
                ret = user.set(comment=campaignComment);
            END;
        END;
        claimResp = http.get(
            referralClaimUrl _ '?' _ toQueryString(alias = campaignSlug, session_id = user.gen_session.id, user_id = user.id, bot_comment_written = (campaignComment ? 1 : 0)),
            timeout = 7
        );
"""
    new = """        IF campaignComment;
            # Native billing state is authoritative. Never overwrite another
            # attribution on an existing account.
            IF !user.comment;
                ret = user.set(comment=campaignComment);
            END;
            IF user.comment == campaignComment;
                campaignCommentConfirmed = 1;
            END;
        END;

        campaignPartnerConfirmed = 0;
        campaignReferralInitialized = 0;
        IF campaignLinkType == 'partner' AND campaignPartnerId > 0
           AND user.partner_id == campaignPartnerId;
            campaignPartnerConfirmed = 1;
            campaignFirstPayPercent = campaignFirstPayPercent + 0;
            IF campaignFirstPayPercent < 0; campaignFirstPayPercent = 0; END;
            IF campaignFirstPayPercent > 100; campaignFirstPayPercent = 100; END;
            IF user.settings.ShpynApp.referral.initialized != 1;
                botRev = (user.settings.ShpynApp.rev || 0) + 0;
                ret = user.set_settings({'ShpynApp' => {
                    'rev' => botRev + 1,
                    'referral' => {
                        'initialized' => 1,
                        'partner_id' => campaignPartnerId,
                        'alias' => campaignSlug,
                        'first_pay_percent' => campaignFirstPayPercent,
                        'first_pay_campaign' => campaignComment,
                        'first_pay_pending' => (campaignFirstPayPercent > 0 ? 1 : 0),
                        'first_pay_applied' => 0,
                        'first_pay_pay_id' => 0
                    }
                } });
            END;
            IF user.settings.ShpynApp.referral.initialized == 1
               AND user.settings.ShpynApp.referral.partner_id == campaignPartnerId
               AND user.settings.ShpynApp.referral.alias == campaignSlug;
                campaignReferralInitialized = 1;
            END;
        END;
        IF referralClaimSecret AND campaignCommentConfirmed
           AND (campaignLinkType == 'campaign' OR campaignReferralInitialized == 1);
            claimResp = http.post(
                referralClaimUrl,
                content = {
                    'alias' => campaignSlug,
                    'user_id' => user.id,
                    'partner_id' => (campaignPartnerConfirmed ? campaignPartnerId : 0),
                    'comment_written' => 1,
                    'referral_initialized' => campaignReferralInitialized
                },
                headers = {'X-Bot-Referral-Secret' => referralClaimSecret},
                timeout = 7
            );
        END;
"""
    assert source.count(old) == 1
    source = source.replace(old, new, 1)
    assert "session_id = user.gen_session.id, user_id = user.id, bot_comment_written" not in source
    return source.replace("\n", newline)


if __name__ == "__main__":
    sys.stdout.write(transform(sys.stdin.read()))
