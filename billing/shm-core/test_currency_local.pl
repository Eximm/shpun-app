#!/usr/bin/env perl
use strict;
use warnings;
use SHM;
use Core::System::ServiceManager qw(get_service);
use Core::Cloud::Currency;

my $shm = SHM->new(user_id => 1);
my $fx = get_service('Cloud::Currency');
my $rates;
{
    no warnings 'redefine';
    local *Core::Cloud::cloud_request = sub { die "SHM Cloud must not be contacted\n" };
    $rates = $fx->currencies || die "Fresh local rates were not loaded\n";
}
die "Missing USD/EUR\n" unless $rates->{USD} && $rates->{EUR};
die "Invalid USD value\n" unless $fx->get_value('USD') > 0;
die "Invalid EUR value\n" unless $fx->get_value('EUR') > 0;
die "Invalid conversion\n" unless $fx->convert(from => 'USD', to => 'RUB', amount => 1) > 0;

my $stale = {
    currencies => $rates,
    fetched_at_epoch => time() - 3 * 86_400,
    effective_at_epoch => time() - 3 * 86_400,
};
die "Stale fetch was accepted\n" if Core::Cloud::Currency::_valid_state($stale);

my $tomorrow = {
    currencies => $rates,
    fetched_at_epoch => time(),
    effective_at_epoch => time() + 8 * 3600,
};
die "Next-day official rate was rejected\n" unless Core::Cloud::Currency::_valid_state($tomorrow);

my $bad = {
    currencies => { USD => { value => 'NaN' }, EUR => { value => 90 } },
    fetched_at_epoch => time(),
    effective_at_epoch => time(),
};
die "Invalid rate was accepted\n" if Core::Cloud::Currency::_valid_state($bad);

print "local_currency_read=ok stale_rejected=ok invalid_rejected=ok\n";
