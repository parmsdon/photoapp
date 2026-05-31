"""
Cluster face encodings with DBSCAN and create PersonCluster records.
Safe to re-run — clears all existing clusters and people tags first.
Use --dry-run to preview results without writing to the database.
"""

import argparse
import time
from collections import Counter

import numpy as np
from flask import Flask
from sklearn.cluster import DBSCAN

import config
import tagger
from models import db, Face, PersonCluster, Photo, Tag

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = config.SQLALCHEMY_DATABASE_URI
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db.init_app(app)


def clear_clusters():
    """Remove all existing cluster data so clustering starts fresh."""
    Face.query.update({"cluster_id": None, "person_name": None})
    for tag in Tag.query.filter_by(tag_type="people").all():
        db.session.delete(tag)
    PersonCluster.query.delete()
    db.session.commit()


def main(eps, min_samples, dry_run):
    start = time.monotonic()

    print("Loading face encodings...")
    faces = Face.query.all()
    if not faces:
        print("No faces found. Run face_detector.py first.")
        return
    print(f"  {len(faces)} face(s) loaded.\n")

    if dry_run:
        print("DRY RUN — no changes will be written to the database.\n")
    else:
        print("Clearing existing clusters and people tags...")
        clear_clusters()

    encodings = np.array([f.encoding for f in faces])

    print(f"Running DBSCAN (eps={eps}, min_samples={min_samples})...")
    labels = DBSCAN(eps=eps, min_samples=min_samples, metric="euclidean").fit_predict(encodings)

    cluster_labels = sorted(set(labels) - {-1})
    unclustered = int((labels == -1).sum())
    print(f"  {len(cluster_labels)} cluster(s) found, {unclustered} unclustered.\n")

    if not cluster_labels:
        print("No clusters found — nothing to save.")
        return

    # Sort clusters largest-first so Person_1 is the most common person
    cluster_sizes = Counter(int(l) for l in labels if l != -1)
    sorted_labels = sorted(cluster_labels, key=lambda l: -cluster_sizes[l])

    # Build lightweight cluster info (used for both dry-run summary and real write)
    cluster_info = []
    for rank, label in enumerate(sorted_labels, 1):
        indices = np.where(labels == label)[0]
        cluster_faces = [faces[i] for i in indices]
        photo_counts = Counter(f.photo_id for f in cluster_faces)
        cluster_info.append({
            "rank": rank,
            "label": label,
            "name": f"Person_{rank:05d}",
            "face_count": len(cluster_faces),
            "sample_photo_id": photo_counts.most_common(1)[0][0],
        })

    if not dry_run:
        label_to_cluster: dict[int, PersonCluster] = {}

        for info in cluster_info:
            cluster = PersonCluster(
                name=info["name"],
                face_count=info["face_count"],
                sample_photo_id=info["sample_photo_id"],
            )
            db.session.add(cluster)
            db.session.flush()
            label_to_cluster[info["label"]] = cluster

        for i, face in enumerate(faces):
            label = int(labels[i])
            if label == -1:
                continue
            cluster = label_to_cluster[label]
            face.cluster_id = cluster.id
            face.person_name = cluster.name

        db.session.flush()

        print("Creating people tags...")
        for cluster in label_to_cluster.values():
            cluster_face_ids = {f.photo_id for f in faces if f.cluster_id == cluster.id}
            tag_pair = [(cluster.name, "people")]
            for photo in Photo.query.filter(Photo.id.in_(cluster_face_ids)).all():
                tagger.apply_tags_to_photo(photo, tag_pair, db.session)

        db.session.commit()

    elapsed = time.monotonic() - start
    clustered = len(faces) - unclustered

    print(f"\n{'=' * 50}")
    print(f"CLUSTERING SUMMARY{'  [DRY RUN]' if dry_run else ''}")
    print(f"{'=' * 50}")
    print(f"  Parameters:           eps={eps}, min_samples={min_samples}")
    print(f"  Total faces:          {len(faces)}")
    print(f"  Clustered:            {clustered}")
    print(f"  Unclustered (noise):  {unclustered}")
    print(f"  Clusters found:       {len(cluster_labels)}")

    top10 = sorted(cluster_info, key=lambda c: -c["face_count"])[:10]
    print(f"\n  Largest clusters:")
    for c in top10:
        print(f"    {c['name']:14} — {c['face_count']} face(s)")

    print(f"\n  Time taken:           {elapsed:.1f}s")
    if dry_run:
        print(f"\n  Run without --dry-run to apply these clusters.")
    print(f"{'=' * 50}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Cluster face encodings with DBSCAN.")
    parser.add_argument("--eps", type=float, default=0.4,
                        help="DBSCAN epsilon — max distance between faces in a cluster (default: 0.4)")
    parser.add_argument("--min-samples", type=int, default=3,
                        help="Minimum faces required to form a cluster (default: 3)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview clustering results without writing to the database")
    args = parser.parse_args()
    with app.app_context():
        main(eps=args.eps, min_samples=args.min_samples, dry_run=args.dry_run)
