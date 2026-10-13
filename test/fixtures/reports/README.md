# Printer reports

Full statuses (`pushall` answers) and `get_version` answers of real Bambu Lab
printers, from the test data of
[ha-bambulab](https://github.com/greghesp/ha-bambulab) (MIT):
`custom_components/bambu_lab/pybambu/mock_data/` and `tests/pybambu/`.

Anonymized: invented serial numbers (`00M00A000000001`…), IP addresses in
`192.0.2.0/24`, spool RFID tags and UUIDs zeroed, task identifiers and file
names replaced. The rest is as the printers sent it.

| File                 | Printer                                      |
| -------------------- | -------------------------------------------- |
| `x1c-multi-ams.json` | X1 Carbon, three AMS and an AMS HT, finished |
| `h2d-dual-ams.json`  | H2D, two nozzles, two AMS 2 Pro, printing    |
| `p1p-ams.json`       | P1P with an AMS (older firmware), failed     |
| `p1p-no-ams.json`    | P1P without AMS, external spool, finished    |
| `a1-ams-lite.json`   | A1 with an AMS lite, idle                    |
