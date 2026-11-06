# Compares two inventories (inventory.sql's format) for the recovery review:
#   awk -F'|' -f reconcile.awk <newer inventory> <candidate inventory>
# Prints, by identifier and state only:
#   deleted-since|<id>|<kind>      in the candidate, not in the newer backup
#   changed-since|<id>|<kind>|then <deleted> <statuses>|now <deleted> <statuses>
# The first file is told apart by its name, not by FNR == NR, which would
# treat the candidate as the newer one when the newer inventory is empty.
FILENAME == ARGV[1] {
  if ($1 == "entry") newer[$2] = $0
  next
}
$1 == "entry" {
  if (!($2 in newer)) {
    print "deleted-since|" $2 "|" $3
    next
  }
  if (newer[$2] != $0) {
    split(newer[$2], now, "|")
    print "changed-since|" $2 "|" $3 "|then " $4 " " $5 "|now " now[4] " " now[5]
  }
}
