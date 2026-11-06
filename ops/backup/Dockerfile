# The backup toolchain: PostgreSQL 18 client tools and age, nothing else.
# The same image runs the scheduled backup (in the private automation
# repository), the owner's restore drill, and this repository's tests.
# docs/hosted-backups.md § The toolchain.
#
# Pinned by digest: postgres:18.6-trixie (the hosted server's major version,
# and the image of the postgres-test-18 service in compose.yaml).
FROM postgres:18.6-trixie@sha256:3a4264520e121176619f54ff867d12774bc81e95e7b84db58d63bccdb6144b81

# age 1.2.1 from Debian trixie (signed by Debian's archive keys); the CA
# store for sslrootcert=system (Neon's certificate chains to ISRG Root X1).
RUN apt-get update \
  && apt-get install --yes --no-install-recommends 'age=1.2.1-*' ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY refrain-backup.sh fingerprint.sql inventory.sql backup-role.sql backup-role-audit.sql /opt/refrain-backup/
RUN ln -s /opt/refrain-backup/refrain-backup.sh /usr/local/bin/refrain-backup

# Not the server: this image never starts PostgreSQL.
ENTRYPOINT []
CMD ["refrain-backup"]
