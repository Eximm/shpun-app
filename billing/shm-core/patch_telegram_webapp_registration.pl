#!/usr/bin/env perl
use strict;
use warnings;

# Apply only to the pinned SHM 3.5.0 image. Fail on changed upstream anchors.
sub replace_once {
    my ($source, $old, $new) = @_;
    my $at = index($source, $old);
    die "SHM patch anchor missing\n" if $at < 0;
    die "SHM patch anchor ambiguous\n" if index($source, $old, $at + 1) >= 0;
    substr($source, $at, length($old), $new);
    return $source;
}

sub patch_routes {
    my ($source) = @_;
    my $old = <<'OLD';
'/telegram/webapp/auth' => {
    swagger => {
        tags => 'Telegram bot',
    },
    GET => {
        params => {
            initData => { type => 'string', required => 1, min_length => 1, max_length => 4096 },
            profile => { type => 'string', required => 1, min_length => 1, max_length => 32 },
OLD
    my $new = $old . <<'NEW';
            register_if_not_exists => { type => 'boolean' },
            partner_id => { type => 'integer', min => 2 },
NEW
    return replace_once($source, $old, $new);
}

sub patch_transport {
    my ($source) = @_;
    my $old_args = <<'OLD';
sub webapp_auth {
    my $self = shift;
    my %args = (
        initData => undef,
        profile => 'telegram_bot',
        @_,
    );
OLD
    my $new_args = <<'NEW';
sub webapp_auth {
    my $self = shift;
    my %args = (
        initData => undef,
        profile => 'telegram_bot',
        register_if_not_exists => 0,
        partner_id => undef,
        @_,
    );
NEW
    $source = replace_once($source, $old_args, $new_args);

    my $old_body = <<'OLD';
    # Step 4: find the user AFTER signature is verified
    my $login = $self->find_user_by_tg( $tg_user );
    unless ( $login ) {
        logger->error("Telegram WebApp auth error: user not found");
        $self->set_user_fail_attempt( 'webapp_auth', 3600, $self->telegram_ips ); # 5 fails/hour
        return undef;
    }

    return {
        session_id => $login->user->srv('sessions')->add(
            settings => { account => { login => $login->get_login, type => $login->get_type } },
        ),
    };
OLD
    my $new_body = <<'NEW';
    # Only a verified Telegram identity may be looked up or registered.
    my $login = $self->find_user_by_tg( $tg_user );
    my $registered = 0;
    my $user = $login ? $login->user : undef;

    if ( !$user && $args{register_if_not_exists} ) {
        $user = $self->user->reg(
            login => $self->get_shm_login( $tg_user->{id} ),
            login_type => 'telegram',
            full_name => sprintf('%s %s', $tg_user->{first_name} || '', $tg_user->{last_name} || ''),
            settings => {
                telegram => {
                    user_id => $tg_user->{id},
                    username => $tg_user->{username},
                    login => $tg_user->{username},
                    first_name => $tg_user->{first_name} || '',
                    last_name => $tg_user->{last_name} || '',
                },
            },
            $args{partner_id} ? ( partner_id => $args{partner_id} ) : (),
        );
        $registered = $user ? 1 : 0;
    }

    unless ( $user ) {
        logger->error("Telegram WebApp auth error: user not found or registration failed");
        $self->set_user_fail_attempt( 'webapp_auth', 3600, $self->telegram_ips );
        return undef;
    }

    # Mini App launch does not prove the bot chat was started. /start later
    # adds chat_id and marks the Telegram profile as a member.
    return {
        session_id => $user->srv('sessions')->add(
            $login ? ( settings => { account => { login => $login->get_login, type => $login->get_type } } ) : (),
        ),
        registered => $registered,
    };
NEW
    return replace_once($source, $old_body, $new_body);
}

sub patch_file {
    my ($path, $transform) = @_;
    open my $in, '<:raw', $path or die "Cannot read $path: $!\n";
    local $/;
    my $original = <$in>;
    close $in;
    my $updated = $transform->($original);
    open my $out, '>:raw', $path or die "Cannot write $path: $!\n";
    print {$out} $updated;
    close $out or die "Cannot close $path: $!\n";
}

@ARGV == 2 or die "usage: patch_telegram_webapp_registration.pl V1_CGI TELEGRAM_PM\n";
patch_file($ARGV[0], \&patch_routes);
patch_file($ARGV[1], \&patch_transport);
