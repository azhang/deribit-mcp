"""Tests for options module."""

import pytest
from deribit_mcp.options import (
    parse_instrument_name,
    filter_instruments_by_expiry,
    build_options_chain_csv
)


class TestParseInstrumentName:
    """Test instrument name parsing."""

    def test_parse_btc_option(self):
        """Test parsing BTC option instrument."""
        result = parse_instrument_name("BTC-27MAR25-50000-C")
        assert result == {
            "currency": "BTC",
            "expiry": "27MAR25",
            "strike": 50000.0,
            "type": "call",
            "instrument_name": "BTC-27MAR25-50000-C"
        }

    def test_parse_eth_usdc_option(self):
        """Test parsing ETH_USDC option instrument."""
        result = parse_instrument_name("ETH_USDC-9OCT25-4000-P")
        assert result == {
            "currency": "ETH_USDC",
            "expiry": "9OCT25",
            "strike": 4000.0,
            "type": "put",
            "instrument_name": "ETH_USDC-9OCT25-4000-P"
        }

    def test_parse_decimal_strike(self):
        """Test parsing option with decimal strike."""
        result = parse_instrument_name("ETH-15DEC25-3500.5-C")
        assert result == {
            "currency": "ETH",
            "expiry": "15DEC25",
            "strike": 3500.5,
            "type": "call",
            "instrument_name": "ETH-15DEC25-3500.5-C"
        }

    def test_parse_call_option(self):
        """Test call option type."""
        result = parse_instrument_name("BTC-1JAN26-60000-C")
        assert result["type"] == "call"

    def test_parse_put_option(self):
        """Test put option type."""
        result = parse_instrument_name("BTC-1JAN26-60000-P")
        assert result["type"] == "put"

    def test_parse_non_option_returns_none(self):
        """Test that non-option instruments return None."""
        assert parse_instrument_name("BTC-PERPETUAL") is None
        assert parse_instrument_name("ETH-PERPETUAL") is None
        assert parse_instrument_name("BTC-25DEC25") is None


class TestFilterInstrumentsByExpiry:
    """Test instrument filtering by expiry."""

    def test_filter_single_expiry(self):
        """Test filtering for single expiry."""
        instruments = [
            {"instrument_name": "ETH_USDC-9OCT25-4000-C"},
            {"instrument_name": "ETH_USDC-9OCT25-4000-P"},
            {"instrument_name": "ETH_USDC-9OCT25-4100-C"},
            {"instrument_name": "ETH_USDC-16OCT25-4000-C"},
            {"instrument_name": "BTC-9OCT25-50000-C"},
        ]

        result = filter_instruments_by_expiry(instruments, "9OCT25")
        assert len(result) == 4
        assert "ETH_USDC-9OCT25-4000-C" in result
        assert "ETH_USDC-9OCT25-4000-P" in result
        assert "ETH_USDC-9OCT25-4100-C" in result
        assert "BTC-9OCT25-50000-C" in result
        assert "ETH_USDC-16OCT25-4000-C" not in result

    def test_filter_case_insensitive(self):
        """Test that expiry filtering is case-insensitive."""
        instruments = [
            {"instrument_name": "BTC-27MAR25-50000-C"},
        ]

        result = filter_instruments_by_expiry(instruments, "27mar25")
        assert len(result) == 1
        assert "BTC-27MAR25-50000-C" in result

    def test_filter_empty_list(self):
        """Test filtering empty instrument list."""
        result = filter_instruments_by_expiry([], "9OCT25")
        assert result == []

    def test_filter_no_matches(self):
        """Test when no instruments match expiry."""
        instruments = [
            {"instrument_name": "ETH_USDC-16OCT25-4000-C"},
            {"instrument_name": "ETH_USDC-23OCT25-4000-P"},
        ]

        result = filter_instruments_by_expiry(instruments, "9OCT25")
        assert result == []


class TestBuildOptionsChainCSV:
    """Test CSV building for options chain."""

    def test_build_simple_chain(self):
        """Test building CSV with simple options data."""
        ticker_data = {
            "ETH_USDC-9OCT25-4000-C": {
                "timestamp": 1234567890,
                "mark_price": 100.0,
                "best_bid_price": 99.0,
                "best_ask_price": 101.0,
                "best_bid_amount": 10.0,
                "best_ask_amount": 5.0,
                "last_price": 100.5,
                "stats": {"volume": 50.0},
                "open_interest": 200.0,
                "greeks": {
                    "delta": 0.5,
                    "gamma": 0.01,
                    "vega": 0.1,
                    "theta": -0.5,
                    "rho": 0.02
                },
                "mark_iv": 50.0,
                "bid_iv": 49.0,
                "ask_iv": 51.0,
                "underlying_price": 4000.0,
                "index_price": 4001.0
            },
            "ETH_USDC-9OCT25-4000-P": {
                "timestamp": 1234567890,
                "mark_price": 95.0,
                "best_bid_price": 94.0,
                "best_ask_price": 96.0,
                "best_bid_amount": 15.0,
                "best_ask_amount": 8.0,
                "last_price": 95.5,
                "stats": {"volume": 30.0},
                "open_interest": 150.0,
                "greeks": {
                    "delta": -0.5,
                    "gamma": 0.01,
                    "vega": 0.1,
                    "theta": -0.4,
                    "rho": -0.02
                },
                "mark_iv": 48.0,
                "bid_iv": 47.0,
                "ask_iv": 49.0,
                "underlying_price": 4000.0,
                "index_price": 4001.0
            }
        }

        csv = build_options_chain_csv(ticker_data, "ETH_USDC", "9OCT25")

        # Check header comments
        assert "# Currency: ETH_USDC" in csv
        assert "# Expiry: 9OCT25" in csv
        assert "# Timestamp: 1234567890" in csv
        assert "# Underlying: 4000.0" in csv
        assert "# Index: 4001.0" in csv

        # Check CSV header line
        assert "strike,type,instrument_name,mark_price" in csv

        # Check data rows
        assert "4000,call,ETH_USDC-9OCT25-4000-C" in csv
        assert "4000,put,ETH_USDC-9OCT25-4000-P" in csv

    def test_build_with_strike_filters(self):
        """Test building CSV with strike price filters."""
        ticker_data = {
            "ETH_USDC-9OCT25-3900-C": {
                "timestamp": 1234567890,
                "mark_price": 120.0,
                "greeks": {"delta": 0.6},
                "underlying_price": 4000.0,
                "index_price": 4001.0
            },
            "ETH_USDC-9OCT25-4000-C": {
                "timestamp": 1234567890,
                "mark_price": 100.0,
                "greeks": {"delta": 0.5},
                "underlying_price": 4000.0,
                "index_price": 4001.0
            },
            "ETH_USDC-9OCT25-4100-C": {
                "timestamp": 1234567890,
                "mark_price": 80.0,
                "greeks": {"delta": 0.4},
                "underlying_price": 4000.0,
                "index_price": 4001.0
            }
        }

        # Filter to only 4000-4100
        csv = build_options_chain_csv(
            ticker_data,
            "ETH_USDC",
            "9OCT25",
            min_strike=4000.0,
            max_strike=4100.0
        )

        # 3900 should be excluded
        assert "3900" not in csv
        assert "4000" in csv
        assert "4100" in csv

    def test_build_with_missing_data(self):
        """Test building CSV with missing optional fields."""
        ticker_data = {
            "BTC-9OCT25-50000-C": {
                "timestamp": 1234567890,
                "mark_price": 1000.0,
                # Missing greeks, bid/ask, etc.
                "underlying_price": 50000.0,
                "index_price": 50001.0
            }
        }

        csv = build_options_chain_csv(ticker_data, "BTC", "9OCT25")

        # Should still generate CSV with empty fields
        assert "50000,call,BTC-9OCT25-50000-C,1000" in csv
        # Empty fields should be present (commas with no data)
        assert ",," in csv

    def test_build_sorted_strikes(self):
        """Test that strikes are sorted in output."""
        ticker_data = {
            "ETH-9OCT25-4100-C": {"mark_price": 80.0, "underlying_price": 4000.0, "index_price": 4000.0},
            "ETH-9OCT25-3900-C": {"mark_price": 120.0, "underlying_price": 4000.0, "index_price": 4000.0},
            "ETH-9OCT25-4000-C": {"mark_price": 100.0, "underlying_price": 4000.0, "index_price": 4000.0},
        }

        csv = build_options_chain_csv(ticker_data, "ETH", "9OCT25")
        lines = csv.split("\n")

        # Find data lines (skip comments and header)
        data_lines = [l for l in lines if l and not l.startswith("#") and "strike" not in l]

        # Strikes should be in order: 3900, 4000, 4100
        strikes = [float(line.split(",")[0]) for line in data_lines]
        assert strikes == sorted(strikes)
