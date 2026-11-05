use strict;
use warnings;
BEGIN { $ENV{REQUEST_METHOD} = 'GET'; $ENV{QUERY_STRING} = 'action=promo.return.status&session_id=local-validation'; }
use SHM;
use Core::System::ServiceManager qw(get_service);
use Core::Utils qw(switch_user);
use Template;
use JSON::PP;
use Fcntl qw(O_WRONLY O_CREAT O_EXCL);
my ($patch_path, $mode, $verify_user, $verify_service) = @ARGV;
die "Verification user and promotional service required" unless ($verify_user || "") =~ /^\d+$/ && ($verify_service || "") =~ /^\d+$/;
die "Patch path required" unless $patch_path;
SHM->new(skip_check_auth => 1);
switch_user(1);
my $tpl = get_service('template', _id => 'shpun_app');
my $original = $tpl->get_data;
die "Template source missing" unless $original;
open my $input, '<:raw', $patch_path or die $!;
my $patch = do { local $/; <$input> }; close $input;
my $source = $original;
if (index($source, 'action == "promo.return.status"') < 0) {
    my $anchor = '{{ ELSIF action == "debug.dump_settings" }}';
    die "Expected one safe insertion point" unless (() = $source =~ /\Q$anchor\E/g) == 1;
    $source =~ s/\Q$anchor\E/$patch$anchor/;
}
my $tt = Template->new({ START_TAG => '\{\{', END_TAG => '\}\}', ANYCASE => 1, EVAL_PERL => 1 });
$tt->context->template(\$source) or die $tt->error;
# Verify the actual billing-backed lifecycle without exposing private settings.
switch_user($verify_user);
my $rendered = $tpl->parse(data => $source);
my $result = decode_json($rendered);
die "Read-only projection invalid" unless $result->{ok} == 1 && ref $result->{return_bonus} eq 'HASH';
die "Restored promotion is not represented" unless $result->{return_bonus}{tariff_user_service_id} == $verify_service && $result->{return_bonus}{tariff_activated} == 1;
if (($mode || '') eq '--apply' && $source ne $original) {
    my $backup_path = '/tmp/shpun-app-before-return-bonus-status-20261105.tt';
    sysopen my $backup, $backup_path, O_WRONLY|O_CREAT|O_EXCL, 0600 or die "Backup: $!";
    binmode $backup; print {$backup} $original; close $backup;
    switch_user(1);
    $tpl->set(data => $source) or die "Template update failed";
    $tpl->reload;
    die "Template readback mismatch" unless $tpl->get_data eq $source;
    print "BILLING_RETURN_PROJECTION_APPLIED\n";
}
print encode_json({ validated => 1, return_bonus => $result->{return_bonus} }), "\n";
