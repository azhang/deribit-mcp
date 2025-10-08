"""Options chain building and formatting utilities."""

import re
from typing import Any, Optional
from datetime import datetime


def parse_instrument_name(instrument_name: str) -> Optional[dict[str, Any]]:
    """Parse an options instrument name into components.

    Args:
        instrument_name: Instrument name like "ETH_USDC-9OCT25-4000-C"

    Returns:
        Dictionary with currency, expiry, strike, option_type, or None if not an option
    """
    # Pattern: CURRENCY[-EXPIRY-STRIKE-TYPE]
    # Examples: BTC-27MAR20-8000-C, ETH_USDC-9OCT25-4000-P
    pattern = r'^([A-Z_]+)-(\d{1,2}[A-Z]{3}\d{2})-(\d+(?:\.\d+)?)-([CP])$'
    match = re.match(pattern, instrument_name)

    if not match:
        return None

    currency, expiry, strike, option_type = match.groups()

    return {
        "currency": currency,
        "expiry": expiry,
        "strike": float(strike),
        "type": "call" if option_type == "C" else "put",
        "instrument_name": instrument_name
    }


def filter_instruments_by_expiry(
    instruments: list[dict[str, Any]],
    expiry: str
) -> list[str]:
    """Filter instruments list to only options matching the expiry.

    Args:
        instruments: List of instrument dictionaries from get_instruments
        expiry: Expiry date string like "9OCT25"

    Returns:
        List of instrument names matching the expiry
    """
    matching = []

    for instrument in instruments:
        name = instrument.get("instrument_name", "")
        parsed = parse_instrument_name(name)

        if parsed and parsed["expiry"].upper() == expiry.upper():
            matching.append(name)

    return matching


def build_options_chain_csv(
    ticker_data: dict[str, dict[str, Any]],
    currency: str,
    expiry: str,
    min_strike: Optional[float] = None,
    max_strike: Optional[float] = None
) -> str:
    """Build CSV representation of options chain from ticker data.

    Args:
        ticker_data: Dictionary mapping instrument_name to ticker data
        currency: Currency symbol
        expiry: Expiry date
        min_strike: Optional minimum strike filter
        max_strike: Optional maximum strike filter

    Returns:
        CSV formatted string with header comments
    """
    # Group by strike
    strikes_data: dict[float, dict[str, Any]] = {}

    # Extract metadata from first ticker
    underlying_price = None
    index_price = None
    timestamp = None

    for instrument_name, data in ticker_data.items():
        parsed = parse_instrument_name(instrument_name)
        if not parsed:
            continue

        strike = parsed["strike"]

        # Apply strike filters
        if min_strike is not None and strike < min_strike:
            continue
        if max_strike is not None and strike > max_strike:
            continue

        # Extract metadata
        if underlying_price is None:
            underlying_price = data.get("underlying_price")
            index_price = data.get("index_price")
            timestamp = data.get("timestamp")

        # Initialize strike entry if needed
        if strike not in strikes_data:
            strikes_data[strike] = {"call": None, "put": None}

        # Store data by type
        option_type = parsed["type"]
        strikes_data[strike][option_type] = {
            "instrument_name": instrument_name,
            "mark_price": data.get("mark_price"),
            "bid_price": data.get("best_bid_price"),
            "ask_price": data.get("best_ask_price"),
            "bid_amount": data.get("best_bid_amount"),
            "ask_amount": data.get("best_ask_amount"),
            "last_price": data.get("last_price"),
            "volume_24h": data.get("stats", {}).get("volume", 0.0),
            "open_interest": data.get("open_interest"),
            "delta": data.get("greeks", {}).get("delta"),
            "gamma": data.get("greeks", {}).get("gamma"),
            "vega": data.get("greeks", {}).get("vega"),
            "theta": data.get("greeks", {}).get("theta"),
            "rho": data.get("greeks", {}).get("rho"),
            "mark_iv": data.get("mark_iv"),
            "bid_iv": data.get("bid_iv"),
            "ask_iv": data.get("ask_iv"),
        }

    # Build CSV
    lines = []

    # Header comments
    lines.append(f"# Currency: {currency}")
    lines.append(f"# Expiry: {expiry}")
    if timestamp:
        lines.append(f"# Timestamp: {timestamp}")
    if underlying_price is not None:
        lines.append(f"# Underlying: {underlying_price}")
    if index_price is not None:
        lines.append(f"# Index: {index_price}")

    # CSV header
    header_fields = [
        "strike",
        "type",
        "instrument_name",
        "mark_price",
        "bid_price",
        "ask_price",
        "bid_amount",
        "ask_amount",
        "last_price",
        "volume_24h",
        "open_interest",
        "delta",
        "gamma",
        "vega",
        "theta",
        "rho",
        "mark_iv",
        "bid_iv",
        "ask_iv"
    ]
    lines.append(",".join(header_fields))

    # Sort strikes
    sorted_strikes = sorted(strikes_data.keys())

    # Build rows
    for strike in sorted_strikes:
        strike_data = strikes_data[strike]

        # Add call row
        call_data = strike_data.get("call")
        if call_data:
            lines.append(_format_csv_row(strike, "call", call_data))

        # Add put row
        put_data = strike_data.get("put")
        if put_data:
            lines.append(_format_csv_row(strike, "put", put_data))

    return "\n".join(lines)


def _format_csv_row(strike: float, option_type: str, data: dict[str, Any]) -> str:
    """Format a single CSV row.

    Args:
        strike: Strike price
        option_type: "call" or "put"
        data: Option data dictionary

    Returns:
        CSV formatted row
    """
    def fmt(value: Any) -> str:
        """Format a value for CSV."""
        if value is None:
            return ""
        if isinstance(value, float):
            return f"{value:.6f}".rstrip("0").rstrip(".")
        return str(value)

    fields = [
        fmt(strike),
        option_type,
        fmt(data.get("instrument_name")),
        fmt(data.get("mark_price")),
        fmt(data.get("bid_price")),
        fmt(data.get("ask_price")),
        fmt(data.get("bid_amount")),
        fmt(data.get("ask_amount")),
        fmt(data.get("last_price")),
        fmt(data.get("volume_24h")),
        fmt(data.get("open_interest")),
        fmt(data.get("delta")),
        fmt(data.get("gamma")),
        fmt(data.get("vega")),
        fmt(data.get("theta")),
        fmt(data.get("rho")),
        fmt(data.get("mark_iv")),
        fmt(data.get("bid_iv")),
        fmt(data.get("ask_iv")),
    ]

    return ",".join(fields)
