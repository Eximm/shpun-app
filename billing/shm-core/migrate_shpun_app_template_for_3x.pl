use strict;
use warnings;
use utf8;
use open ':std', ':encoding(UTF-8)';

my $path = shift @ARGV or die "usage: $0 shpun_app.tpl\n";
open my $fh, '<:encoding(UTF-8)', $path or die "open $path: $!\n";
local $/;
my $template = <$fh>;
close $fh;
my $newline = index($template, "\r\n") >= 0 ? "\r\n" : "\n";

my $old_session = <<'OLD';
{{ # --- resolve user by provided session_id (safe) --- }}
{{ uid = "" }}
{{ IF session.id }}
  {{ uid = session.id(sid).user_id }}
{{ END }}
{{ IF uid == null OR uid == "" }}
  {{ uid = session.user_id }}
{{ END }}

{{ u = user.switch(uid) }}
OLD

my $new_session = <<'NEW';
{{ # SHM authenticates session_id before executing this protected template. }}
{{ u = user }}
NEW

my $old_telegram = <<'OLD';
  {{ tg_login2 = "@" _ tg_id }}
  {{ login2_ret = u.set(login2 = tg_login2) }}
OLD

my $new_telegram = <<'NEW';
  {{ # SHM 3.x binds the Telegram account through its signed web auth route. }}
NEW

my $old_onboarding = <<'OLD';
{{ user_login2 = u.login2 || "" }}

{{ IF spw == 0 AND pws == 1 }}
  {{ spw = 1 }}
{{ END }}

{{ IF se == 0 AND user_login2 != "" }}
  {{ se = 1 }}
{{ END }}
OLD

my $new_onboarding = <<'NEW';
{{ verified_email = u.email || "" }}

{{ IF spw == 0 AND pws == 1 }}
  {{ spw = 1 }}
{{ END }}

{{ IF se == 0 AND verified_email != "" }}
  {{ se = 1 }}
{{ END }}
NEW

for my $replacement (
    [$old_session, $new_session],
    [$old_telegram, $new_telegram],
    [$old_onboarding, $new_onboarding],
) {
    my ($old, $new) = @$replacement;
    $old =~ s/\n/$newline/g;
    $new =~ s/\n/$newline/g;
    my $count = () = $template =~ /\Q$old\E/g;
    die "expected exactly one matching block, found $count\n" unless $count == 1;
    $template =~ s/\Q$old\E/$new/;
}

print $template;
