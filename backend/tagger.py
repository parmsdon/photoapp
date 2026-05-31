"""
Shared tag generation logic used by importer.py and tag_enricher.py.
"""

import os

# ISO 3166-1 alpha-2 → full country name
COUNTRY_NAMES = {
    "AF": "Afghanistan", "AX": "Åland Islands", "AL": "Albania", "DZ": "Algeria",
    "AS": "American Samoa", "AD": "Andorra", "AO": "Angola", "AI": "Anguilla",
    "AQ": "Antarctica", "AG": "Antigua and Barbuda", "AR": "Argentina",
    "AM": "Armenia", "AW": "Aruba", "AU": "Australia", "AT": "Austria",
    "AZ": "Azerbaijan", "BS": "Bahamas", "BH": "Bahrain", "BD": "Bangladesh",
    "BB": "Barbados", "BY": "Belarus", "BE": "Belgium", "BZ": "Belize",
    "BJ": "Benin", "BM": "Bermuda", "BT": "Bhutan", "BO": "Bolivia",
    "BQ": "Bonaire, Sint Eustatius and Saba", "BA": "Bosnia and Herzegovina",
    "BW": "Botswana", "BV": "Bouvet Island", "BR": "Brazil",
    "IO": "British Indian Ocean Territory", "BN": "Brunei", "BG": "Bulgaria",
    "BF": "Burkina Faso", "BI": "Burundi", "CV": "Cabo Verde", "KH": "Cambodia",
    "CM": "Cameroon", "CA": "Canada", "KY": "Cayman Islands",
    "CF": "Central African Republic", "TD": "Chad", "CL": "Chile", "CN": "China",
    "CX": "Christmas Island", "CC": "Cocos (Keeling) Islands", "CO": "Colombia",
    "KM": "Comoros", "CG": "Congo", "CD": "Congo (DRC)", "CK": "Cook Islands",
    "CR": "Costa Rica", "CI": "Côte d'Ivoire", "HR": "Croatia", "CU": "Cuba",
    "CW": "Curaçao", "CY": "Cyprus", "CZ": "Czech Republic", "DK": "Denmark",
    "DJ": "Djibouti", "DM": "Dominica", "DO": "Dominican Republic", "EC": "Ecuador",
    "EG": "Egypt", "SV": "El Salvador", "GQ": "Equatorial Guinea", "ER": "Eritrea",
    "EE": "Estonia", "SZ": "Eswatini", "ET": "Ethiopia",
    "FK": "Falkland Islands", "FO": "Faroe Islands", "FJ": "Fiji", "FI": "Finland",
    "FR": "France", "GF": "French Guiana", "PF": "French Polynesia",
    "TF": "French Southern Territories", "GA": "Gabon", "GM": "Gambia",
    "GE": "Georgia", "DE": "Germany", "GH": "Ghana", "GI": "Gibraltar",
    "GR": "Greece", "GL": "Greenland", "GD": "Grenada", "GP": "Guadeloupe",
    "GU": "Guam", "GT": "Guatemala", "GG": "Guernsey", "GN": "Guinea",
    "GW": "Guinea-Bissau", "GY": "Guyana", "HT": "Haiti",
    "HM": "Heard Island and McDonald Islands", "VA": "Holy See", "HN": "Honduras",
    "HK": "Hong Kong", "HU": "Hungary", "IS": "Iceland", "IN": "India",
    "ID": "Indonesia", "IR": "Iran", "IQ": "Iraq", "IE": "Ireland",
    "IM": "Isle of Man", "IL": "Israel", "IT": "Italy", "JM": "Jamaica",
    "JP": "Japan", "JE": "Jersey", "JO": "Jordan", "KZ": "Kazakhstan",
    "KE": "Kenya", "KI": "Kiribati", "KP": "North Korea", "KR": "South Korea",
    "KW": "Kuwait", "KG": "Kyrgyzstan", "LA": "Laos", "LV": "Latvia",
    "LB": "Lebanon", "LS": "Lesotho", "LR": "Liberia", "LY": "Libya",
    "LI": "Liechtenstein", "LT": "Lithuania", "LU": "Luxembourg", "MO": "Macao",
    "MG": "Madagascar", "MW": "Malawi", "MY": "Malaysia", "MV": "Maldives",
    "ML": "Mali", "MT": "Malta", "MH": "Marshall Islands", "MQ": "Martinique",
    "MR": "Mauritania", "MU": "Mauritius", "YT": "Mayotte", "MX": "Mexico",
    "FM": "Micronesia", "MD": "Moldova", "MC": "Monaco", "MN": "Mongolia",
    "ME": "Montenegro", "MS": "Montserrat", "MA": "Morocco", "MZ": "Mozambique",
    "MM": "Myanmar", "NA": "Namibia", "NR": "Nauru", "NP": "Nepal",
    "NL": "Netherlands", "NC": "New Caledonia", "NZ": "New Zealand",
    "NI": "Nicaragua", "NE": "Niger", "NG": "Nigeria", "NU": "Niue",
    "NF": "Norfolk Island", "MK": "North Macedonia",
    "MP": "Northern Mariana Islands", "NO": "Norway", "OM": "Oman",
    "PK": "Pakistan", "PW": "Palau", "PS": "Palestine", "PA": "Panama",
    "PG": "Papua New Guinea", "PY": "Paraguay", "PE": "Peru", "PH": "Philippines",
    "PN": "Pitcairn", "PL": "Poland", "PT": "Portugal", "PR": "Puerto Rico",
    "QA": "Qatar", "RE": "Réunion", "RO": "Romania", "RU": "Russia",
    "RW": "Rwanda", "BL": "Saint Barthélemy", "SH": "Saint Helena",
    "KN": "Saint Kitts and Nevis", "LC": "Saint Lucia",
    "MF": "Saint Martin", "PM": "Saint Pierre and Miquelon",
    "VC": "Saint Vincent and the Grenadines", "WS": "Samoa", "SM": "San Marino",
    "ST": "São Tomé and Príncipe", "SA": "Saudi Arabia", "SN": "Senegal",
    "RS": "Serbia", "SC": "Seychelles", "SL": "Sierra Leone", "SG": "Singapore",
    "SX": "Sint Maarten", "SK": "Slovakia", "SI": "Slovenia",
    "SB": "Solomon Islands", "SO": "Somalia", "ZA": "South Africa",
    "GS": "South Georgia and the South Sandwich Islands", "SS": "South Sudan",
    "ES": "Spain", "LK": "Sri Lanka", "SD": "Sudan", "SR": "Suriname",
    "SJ": "Svalbard and Jan Mayen", "SE": "Sweden", "CH": "Switzerland",
    "SY": "Syria", "TW": "Taiwan", "TJ": "Tajikistan", "TZ": "Tanzania",
    "TH": "Thailand", "TL": "Timor-Leste", "TG": "Togo", "TK": "Tokelau",
    "TO": "Tonga", "TT": "Trinidad and Tobago", "TN": "Tunisia", "TR": "Turkey",
    "TM": "Turkmenistan", "TC": "Turks and Caicos Islands", "TV": "Tuvalu",
    "UG": "Uganda", "UA": "Ukraine", "AE": "United Arab Emirates",
    "GB": "United Kingdom", "US": "United States",
    "UM": "United States Minor Outlying Islands", "UY": "Uruguay",
    "UZ": "Uzbekistan", "VU": "Vanuatu", "VE": "Venezuela", "VN": "Vietnam",
    "VG": "British Virgin Islands", "VI": "US Virgin Islands",
    "WF": "Wallis and Futuna", "EH": "Western Sahara", "YE": "Yemen",
    "ZM": "Zambia", "ZW": "Zimbabwe",
}

SEASONS = {
    12: "Winter", 1: "Winter", 2: "Winter",
    3: "Spring", 4: "Spring", 5: "Spring",
    6: "Summer", 7: "Summer", 8: "Summer",
    9: "Autumn", 10: "Autumn", 11: "Autumn",
}


def generate_location_tags(lat, lon):
    """
    Reverse geocode (lat, lon) and return typed (name, tag_type) tuples:
      town/city  → tag_type='location'
      region     → tag_type='region'
      country    → tag_type='country'
    """
    if lat is None or lon is None:
        return []
    try:
        import reverse_geocoder as rg
        results = rg.search([(float(lat), float(lon))], verbose=False)
        if not results:
            return []
        r = results[0]
        tags = []
        if r.get("name"):
            tags.append((r["name"], "location"))
        if r.get("admin1"):
            tags.append((r["admin1"], "region"))
        if r.get("cc"):
            country_name = COUNTRY_NAMES.get(r["cc"], r["cc"])
            tags.append((country_name, "country"))
        return tags
    except Exception:
        return []


def generate_date_tags(date_taken):
    """
    Return typed (name, tag_type) tuples:
      year   → tag_type='year'
      month  → tag_type='month'
      season → tag_type='season'
    """
    if date_taken is None:
        return []
    return [
        (str(date_taken.year), "year"),
        (date_taken.strftime("%B"), "month"),
        (SEASONS[date_taken.month], "season"),
    ]


def generate_source_tag(filepath):
    """Return a (name, 'source') tuple using the file's immediate parent folder name."""
    return (os.path.basename(os.path.dirname(filepath)), "source")


def apply_tags_to_photo(photo, tags, db_session):
    """
    Associate (name, tag_type) pairs with a photo, creating Tag rows as needed.
    Skips pairs that are already present on the photo. Does not commit.
    Returns the number of tags newly added.
    """
    from models import Tag

    existing_ids = {t.id for t in photo.tags}
    added = 0
    for name, tag_type in tags:
        if not name:
            continue
        tag = Tag.query.filter_by(name=name, tag_type=tag_type).first()
        if not tag:
            tag = Tag(name=name, tag_type=tag_type)
            db_session.add(tag)
            db_session.flush()
        if tag.id not in existing_ids:
            photo.tags.append(tag)
            existing_ids.add(tag.id)
            added += 1
    return added
