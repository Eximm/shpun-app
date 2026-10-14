use strict;
use warnings;

my $path = shift @ARGV or die "usage: $0 Passwd.pm\n";
open my $in, '<', $path or die "read $path: $!\n";
local $/;
my $source = <$in>;
close $in;

my $before = <<'BEFORE';
    return { msg => 'Password reset failed' } unless $ret;

    $login_obj->set_settings({
BEFORE

my $after = <<'AFTER';
    return { msg => 'Password reset failed' } unless $ret;

    # passwd() updates the account password through another object. Fetch a
    # fresh account object before merging reset-token cleanup; the old object
    # still caches the previous password hash. reload() cannot be used here:
    # account objects created by items() do not carry an id for Base::reload.
    $login_obj = $self->logins->id( $login_str, ['login','email'] );
    return { msg => 'Account not found after password reset' } unless $login_obj;
    $login_obj->set_settings({
AFTER

my $matches = () = $source =~ /\Q$before\E/g;
die "Expected exactly one password reset anchor, found $matches\n" unless $matches == 1;
$source =~ s/\Q$before\E/$after/ or die "Password reset patch failed\n";

open my $out, '>', $path or die "write $path: $!\n";
print {$out} $source;
close $out or die "close $path: $!\n";
