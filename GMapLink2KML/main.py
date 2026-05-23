import sys
import html
import json
import math
import random
import secrets
import string
import time
import requests
import xml.etree.ElementTree as ET
from datetime import datetime
from bs4 import BeautifulSoup
from urllib.parse import urljoin, urlparse

KML_NS = "http://www.opengis.net/kml/2.2"
GX_NS = "http://www.google.com/kml/ext/2.2"
ATOM_NS = "http://www.w3.org/2005/Atom"
KML_TEMPLATE = "sample.kml"
KML_RANDOM_LENGTH = 4
ROUTE_COORDINATES_OUTPUT = "gps_only.json"
PRIMARY_ROUTE_INDEX = 0
COORDINATE_SCALE = 10000000
ROUTE_SIMPLIFY_RATIO = 0.05
MIN_SIMPLIFIED_POINTS = 2
REQUEST_TIMEOUT_SECONDS = 20
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    "DNT": "1",
    "Pragma": "no-cache",
    "Upgrade-Insecure-Requests": "1",
}


ET.register_namespace("gx", GX_NS)
ET.register_namespace("atom", ATOM_NS)
ET.register_namespace("", KML_NS)


def kml_tag(name):
    return f"{{{KML_NS}}}{name}"


def is_allowed_google_host(hostname):
    host = (hostname or "").lower().rstrip(".")
    return (
        host == "google.com"
        or host.endswith(".google.com")
        or host == "goo.gl"
        or host.endswith(".goo.gl")
    )


def validate_google_url(url):
    parsed = urlparse(url)
    if parsed.scheme != "https" or not is_allowed_google_host(parsed.hostname):
        raise ValueError("URL must be an HTTPS Google Maps or goo.gl URL")
    return url


def polite_pause():
    time.sleep(random.uniform(0.35, 1.1))


def google_get(session, url, referer=None):
    validate_google_url(url)
    headers = dict(REQUEST_HEADERS)
    if referer:
        headers["Referer"] = referer
    polite_pause()
    response = session.get(url, headers=headers, timeout=REQUEST_TIMEOUT_SECONDS, allow_redirects=True)
    response.raise_for_status()
    validate_google_url(response.url)
    return response


def format_coord(lat, lon):
    return f"{lon},{lat},0"


def make_text_element(parent, tag, text):
    element = ET.SubElement(parent, kml_tag(tag))
    element.text = text
    return element


def make_kml_output_name():
    today = datetime.now().strftime("%Y%m%d")
    suffix = "".join(secrets.choice(string.ascii_uppercase) for _ in range(KML_RANDOM_LENGTH))
    return f"route-{today}_{suffix}.kml"


def make_route_placemark(points):
    placemark = ET.Element(kml_tag("Placemark"))
    make_text_element(placemark, "name", "Route")
    make_text_element(placemark, "styleUrl", "#RouteMark")

    line = ET.SubElement(placemark, kml_tag("LineString"))
    make_text_element(line, "tessellate", "1")
    make_text_element(line, "extrude", "1")
    make_text_element(line, "altitudeMode", "absolute")
    make_text_element(
        line,
        "coordinates",
        "\n" + "\n".join(format_coord(lat, lon) for lat, lon in points) + "\n",
    )
    return placemark


def make_point_placemark(index, lat, lon):
    name = f"F{index:04d}"
    placemark = ET.Element(kml_tag("Placemark"))
    make_text_element(placemark, "name", name)
    make_text_element(placemark, "styleUrl", "#WPMark")
    make_text_element(placemark, "description", f"{name} (Waypoint)")

    point = ET.SubElement(placemark, kml_tag("Point"))
    make_text_element(point, "altitudeMode", "absolute")
    make_text_element(point, "coordinates", format_coord(lat, lon))
    return placemark


def load_template_document(template_path):
    tree = ET.parse(template_path)
    root = tree.getroot()
    document = root.find(kml_tag("Document"))
    if document is None:
        raise ValueError(f"No Document element found in {template_path}")
    return tree, document


def remove_existing_placemarks(document):
    for child in list(document):
        if child.tag == kml_tag("Placemark"):
            document.remove(child)


def set_document_name(document, name):
    name_element = document.find(kml_tag("name"))
    if name_element is None:
        name_element = ET.Element(kml_tag("name"))
        document.insert(0, name_element)
    name_element.text = name


def indent_xml(element, level=0, space="\t"):
    indent = "\n" + level * space
    child_indent = "\n" + (level + 1) * space

    children = list(element)
    if children:
        if not element.text or not element.text.strip():
            element.text = child_indent

        for child in children:
            indent_xml(child, level + 1, space)

        if not element.tail or not element.tail.strip():
            element.tail = indent
    elif level and (not element.tail or not element.tail.strip()):
        element.tail = indent


def format_kml_tree(tree):
    if hasattr(ET, "indent"):
        ET.indent(tree, space="\t")
    else:
        indent_xml(tree.getroot())


def write_kml(points, output_path=None, template_path=KML_TEMPLATE):
    if not points:
        raise ValueError("No GPS coordinates available for KML output")

    if output_path is None:
        output_path = make_kml_output_name()

    tree, document = load_template_document(template_path)
    set_document_name(document, output_path)
    remove_existing_placemarks(document)
    document.append(make_route_placemark(points))

    for index, (lat, lon) in enumerate(points, start=1):
        document.append(make_point_placemark(index, lat, lon))

    format_kml_tree(tree)
    tree.write(output_path, encoding="UTF-8", xml_declaration=True)
    return output_path


def validate_gps_points(points):
    for index, point in enumerate(points, start=1):
        if (
            not isinstance(point, list)
            or len(point) != 2
            or not all(isinstance(value, (int, float)) for value in point)
            or not -90 <= point[0] <= 90
            or not -180 <= point[1] <= 180
        ):
            raise ValueError(f"Invalid GPS point at index {index}: {point}")

    return points


def coordinate_to_xy(point, reference_lat):
    lat, lon = point
    return (
        lon * 111320 * math.cos(math.radians(reference_lat)),
        lat * 110540,
    )


def point_segment_distance(point, start, end, reference_lat):
    px, py = coordinate_to_xy(point, reference_lat)
    sx, sy = coordinate_to_xy(start, reference_lat)
    ex, ey = coordinate_to_xy(end, reference_lat)

    dx = ex - sx
    dy = ey - sy
    if dx == 0 and dy == 0:
        return math.hypot(px - sx, py - sy)

    segment_fraction = ((px - sx) * dx + (py - sy) * dy) / (dx * dx + dy * dy)
    segment_fraction = max(0, min(1, segment_fraction))
    nearest_x = sx + segment_fraction * dx
    nearest_y = sy + segment_fraction * dy
    return math.hypot(px - nearest_x, py - nearest_y)


def find_most_important_point(points, start_index, end_index, reference_lat):
    best_index = None
    best_distance = -1

    for index in range(start_index + 1, end_index):
        distance = point_segment_distance(
            points[index],
            points[start_index],
            points[end_index],
            reference_lat,
        )
        if distance > best_distance:
            best_index = index
            best_distance = distance

    return best_index, best_distance


def simplify_route(points, ratio=ROUTE_SIMPLIFY_RATIO):
    if len(points) <= MIN_SIMPLIFIED_POINTS:
        return points

    target_count = int(len(points) * ratio + 0.5)
    target_count = max(MIN_SIMPLIFIED_POINTS, min(len(points), target_count))
    if target_count >= len(points):
        return points

    reference_lat = sum(point[0] for point in points) / len(points)
    selected_indexes = {0, len(points) - 1}
    segments = [(0, len(points) - 1)]

    while len(selected_indexes) < target_count and segments:
        best_segment = None
        best_index = None
        best_distance = -1

        for segment in segments:
            start_index, end_index = segment
            index, distance = find_most_important_point(
                points,
                start_index,
                end_index,
                reference_lat,
            )
            if index is not None and distance > best_distance:
                best_segment = segment
                best_index = index
                best_distance = distance

        if best_index is None:
            break

        selected_indexes.add(best_index)
        segments.remove(best_segment)
        start_index, end_index = best_segment
        if best_index - start_index > 1:
            segments.append((start_index, best_index))
        if end_index - best_index > 1:
            segments.append((best_index, end_index))

    return [points[index] for index in sorted(selected_indexes)]


def is_gps_point_list(value):
    if not isinstance(value, list) or not value:
        return False

    return all(
        isinstance(point, list)
        and len(point) == 2
        and all(isinstance(coord, (int, float)) for coord in point)
        for point in value
    )


def decode_delta_coordinates(route_geometry):
    if (
        not isinstance(route_geometry, list)
        or len(route_geometry) < 2
        or not isinstance(route_geometry[0], list)
        or not isinstance(route_geometry[1], list)
    ):
        raise ValueError("Route geometry does not contain encoded coordinate arrays")

    lat_values = route_geometry[0]
    lon_values = route_geometry[1]
    if len(lat_values) != len(lon_values):
        raise ValueError("Encoded route latitude and longitude arrays have different lengths")

    points = []
    lat = 0
    lon = 0

    for index, (lat_delta, lon_delta) in enumerate(zip(lat_values, lon_values)):
        if not isinstance(lat_delta, int) or not isinstance(lon_delta, int):
            raise ValueError(f"Invalid encoded coordinate at index {index}")

        if index == 0:
            lat = lat_delta
            lon = lon_delta
        else:
            lat += lat_delta
            lon += lon_delta

        points.append([lat / COORDINATE_SCALE, lon / COORDINATE_SCALE])

    return validate_gps_points(points)


def extract_route_coordinates(data, route_index=PRIMARY_ROUTE_INDEX):
    try:
        routes = data[0][7]
        route_geometry = routes[route_index]
    except (TypeError, IndexError):
        raise ValueError("No encoded route geometry found in Google Maps response")

    return decode_delta_coordinates(route_geometry)


def load_coordinates(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if is_gps_point_list(data):
        return validate_gps_points(data)

    return extract_route_coordinates(data)


def write_route_outputs(coords):
    simplified_coords = simplify_route(coords)

    with open(ROUTE_COORDINATES_OUTPUT, "w", encoding="utf-8") as f:
        json.dump(simplified_coords, f, indent=4)

    output_path = write_kml(simplified_coords)
    return simplified_coords, output_path


if __name__ == "__main__":

    if len(sys.argv) < 2:
        print("Insufficient argument, require Google Map shared uri, output.json, or gps_only.json")
        sys.exit(1)

    gmap_uri = sys.argv[1]

    if gmap_uri.endswith(".json"):
        coords = load_coordinates(gmap_uri)
        simplified_coords, output_path = write_route_outputs(coords)
        print(f"Found {len(coords)} route coordinates")
        print(f"Kept {len(simplified_coords)} simplified route coordinates")
        print(f"Wrote {ROUTE_COORDINATES_OUTPUT}")
        print(f"Wrote {output_path}")
        sys.exit(0)

    validate_google_url(gmap_uri)
    session = requests.Session()
    redirect_web = google_get(session, gmap_uri)
    soup = BeautifulSoup(redirect_web.text, "html.parser")

    tag = soup.find(
        "link",
        attrs={
            "as": "fetch",
            "crossorigin": "",
            "rel": ["preload"]
        }
    )

    if not tag:
        print("No matching tag found")
        sys.exit(1)

    decoded_uri = html.unescape(tag.get("href"))
    next_stage_uri = urljoin("https://www.google.com", decoded_uri)
    validate_google_url(next_stage_uri)
    next_stage_uri = next_stage_uri.replace(
        "&hl=zh-TW",
        "&hl=en-us"
    )

    nav_info = google_get(session, next_stage_uri, referer=redirect_web.url)
    raw = nav_info.text
    if raw.startswith(")]}'"):
        raw = raw[4:]

    data = json.loads(raw)
    with open("output.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)

    coords = extract_route_coordinates(data)

    simplified_coords, output_path = write_route_outputs(coords)

    print(f"Found {len(coords)} route coordinates")
    print(f"Kept {len(simplified_coords)} simplified route coordinates")
    print(f"Wrote {ROUTE_COORDINATES_OUTPUT}")
    print(f"Wrote {output_path}")

    sys.exit(0)
