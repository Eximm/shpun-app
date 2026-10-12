package Core::Cloud::Currency;

# Local Shpun FX adapter for SHM 3.5.0. The public conversion interface follows
# danuk/shm (Apache-2.0); rates are stored in this SHM instance, never in SHM Cloud.
use v5.14;
use parent 'Core::Cloud';
use Core::Base;
use Core::Utils qw(decode_json encode_json round round_up round_down);
use Core::System::ServiceManager qw(get_service);
use Digest::SHA qw(sha256_hex);
use POSIX qw(strftime);

use constant RATE_KEY          => 'shpun_fx';
use constant MAX_FETCH_AGE     => 48 * 3600;
use constant MAX_EFFECTIVE_AGE => 7 * 24 * 3600;

sub _valid_rate {
    my $cur = shift;
    return 0 unless ref($cur) eq 'HASH';
    return 0 unless defined $cur->{value};
    my $raw = "$cur->{value}";
    return 0 unless $raw =~ /\A(?:\d+)(?:\.\d+)?\z/;
    return 0 unless $raw > 0 && $raw < 1_000_000_000;
    return 1;
}

sub _valid_state {
    my $state = shift;
    return 0 unless ref($state) eq 'HASH';
    return 0 unless ref($state->{currencies}) eq 'HASH';
    return 0 unless _valid_rate($state->{currencies}->{USD});
    return 0 unless _valid_rate($state->{currencies}->{EUR});

    my $now = time();
    for my $field (qw(fetched_at_epoch effective_at_epoch)) {
        return 0 unless defined $state->{$field} && "$state->{$field}" =~ /\A\d{10}\z/;
    }
    return 0 if $state->{fetched_at_epoch} > $now + 300;
    # CBR publishes the next business day's official rate in advance.
    return 0 if $state->{effective_at_epoch} > $now + 86_400;
    return 0 if $now - $state->{fetched_at_epoch} > MAX_FETCH_AGE;
    return 0 if $now - $state->{effective_at_epoch} > MAX_EFFECTIVE_AGE;

    for my $code (keys %{$state->{currencies}}) {
        return 0 unless $code =~ /\A[A-Z]{3}\z/;
        return 0 unless _valid_rate($state->{currencies}->{$code});
    }
    return 1;
}

sub currencies {
    my $self = shift;
    my %args = (no_cache => 0, @_);
    my ($payload) = $self->dbh->selectrow_array(
        'SELECT `value` FROM config WHERE `key` = ?', undef, RATE_KEY
    );
    my $state = $payload ? eval { decode_json($payload) } : undef;
    unless (_valid_state($state)) {
        logger->warning('Local currency rates are missing, invalid or stale');
        return undef;
    }
    return $state->{currencies};
}

# Kept for the existing admin endpoint. A manual update is explicit and is
# replaced by the next successful local rate sync.
sub save {
    my $self = shift;
    my %args = (currencies => {}, @_);
    my $currencies = $args{currencies};
    my $now = time();
    my $effective_date = strftime('%Y-%m-%d', gmtime($now));
    my $state = {
        source => 'manual',
        effective_date => $effective_date,
        fetched_at_epoch => $now,
        effective_at_epoch => $now,
        currencies => $currencies,
    };
    unless (_valid_state($state)) {
        report->status(400);
        report->add_error('Invalid local currency rates');
        return undef;
    }

    my $payload = encode_json($state);
    my $fingerprint = sha256_hex($payload);
    my $fetched_at = strftime('%Y-%m-%d %H:%M:%S', gmtime($now));
    my $dbh = $self->dbh;
    my $audited = $dbh->do(
        'INSERT IGNORE INTO shpun_fx_history '
        . '(source, effective_date, fetched_at, fingerprint, payload) '
        . 'VALUES (?, ?, ?, ?, ?)',
        undef, 'manual', $effective_date, $fetched_at, $fingerprint, $payload
    );
    return undef unless defined $audited;
    my $saved = $dbh->do(
        'INSERT INTO config (`key`, `value`) VALUES (?, ?) '
        . 'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)',
        undef, RATE_KEY, $payload
    );
    return undef unless defined $saved;
    return $currencies;
}

sub get {
    my $self = shift;
    my $currency = uc(shift // '');
    my $currencies = $self->currencies || return undef;
    return $currencies->{$currency};
}

sub get_value {
    my $self = shift;
    my $currency = uc(shift // '');
    return 1 if $currency eq 'RUB';
    my $cur = $self->get($currency);
    return $cur ? $self->_calculate_effective_value($cur) : undef;
}

sub _calculate_effective_value {
    my $self = shift;
    my $cur = shift;
    return undef unless _valid_rate($cur);
    my $base = $cur->{value};
    my $kind = $cur->{addition_type};
    my $amount = $cur->{addition_value};
    return $base unless defined $kind && defined $amount;
    return undef unless "$amount" =~ /\A-?\d+(?:\.\d+)?\z/;

    my $value = $kind eq 'fixed'   ? $amount
              : $kind eq 'numeric' ? $base + $amount
              : $kind eq 'percent' ? $base * (1 + $amount / 100)
              : $base;
    return $value > 0 ? $value : undef;
}

sub from {
    my ($self, $currency, $amount) = @_;
    my $value = $self->get_value($currency);
    return undef unless $value;
    return round($amount * $value);
}

sub to {
    my ($self, $currency, $amount) = @_;
    my $value = $self->get_value($currency);
    return undef unless $value;
    return round($amount / $value);
}

sub system_currency {
    my $self = shift;
    state $currency //= get_service('config', _id => 'billing')->get_data->{currency} || 'RUB';
    return $currency;
}

sub convert {
    my $self = shift;
    my %args = (from => '', to => '', amount => 0, get_smart_args(@_));
    my $system_currency = uc($self->system_currency);
    my $from_currency = uc($args{from} || $system_currency);
    my $to_currency = uc($args{to} || $system_currency);
    my $amount = $args{amount};
    return round($amount) if $from_currency eq $to_currency;

    my $from_value = $self->get_value($from_currency);
    my $to_value = $self->get_value($to_currency);
    return undef unless defined $from_value && defined $to_value;
    my $converted = $amount * $from_value / $to_value;
    return round_up($converted) if $from_currency eq $system_currency;
    return round_down($converted) if $to_currency eq $system_currency;
    return round($converted);
}

1;
