import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import sync_cbr_rates as fx


def fixture(date: str, usd: str = "100,00", eur: str = "110,00") -> bytes:
    return f"""<?xml version='1.0' encoding='UTF-8'?>
<ValCurs Date='{date}'>
  <Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>{usd}</Value><Name>US Dollar</Name></Valute>
  <Valute><CharCode>EUR</CharCode><Nominal>10</Nominal><Value>{eur}</Value><Name>Euro</Name></Valute>
</ValCurs>""".encode()


class LocalFxSyncTests(unittest.TestCase):
    def setUp(self):
        self.today = datetime.now(timezone.utc).strftime("%d.%m.%Y")

    def test_nominal_is_normalized_to_one_unit(self):
        state = fx.parse_rates(fixture(self.today))
        self.assertEqual(state["currencies"]["RUB"]["value"], "1")
        self.assertEqual(state["currencies"]["USD"]["value"], "100.00")
        self.assertEqual(state["currencies"]["EUR"]["value"], "11.00")

    def test_rejects_nonpositive_rate(self):
        with self.assertRaisesRegex(ValueError, "out of bounds"):
            fx.parse_rates(fixture(self.today, usd="0"))

    def test_rejects_missing_mandatory_currency(self):
        xml = fixture(self.today).replace(b"<CharCode>EUR</CharCode>", b"<CharCode>JPY</CharCode>")
        with self.assertRaisesRegex(ValueError, "mandatory"):
            fx.parse_rates(xml)

    def test_manual_override_can_be_replaced_by_official_rates(self):
        state = fx.parse_rates(fixture(self.today))
        with patch.object(fx, "mysql", side_effect=["manual\t9999-01-01", ""]) as db:
            fx.store_rates("stage-mysql", state)
        self.assertEqual(db.call_count, 2)
        self.assertIn("START TRANSACTION", db.call_args_list[1].args[1])

    def test_older_official_rates_cannot_replace_newer_official_rates(self):
        state = fx.parse_rates(fixture(self.today))
        with patch.object(fx, "mysql", return_value="cbr\t9999-01-01") as db:
            with self.assertRaisesRegex(ValueError, "newer official"):
                fx.store_rates("stage-mysql", state)
        self.assertEqual(db.call_count, 1)


if __name__ == "__main__":
    unittest.main()
