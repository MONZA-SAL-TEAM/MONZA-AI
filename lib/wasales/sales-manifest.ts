/**
 * The imported sales material — GENERATED, do not edit by hand.
 *
 * Written by:
 *   node scripts/import-sales-folder.mjs "<path to Monza AI sales>" --write
 *
 * The application never invents a model or a colour: everything below is the
 * folder's own directory and file names.
 */

export interface ManifestFile {
  fileName: string;
  bytes: number;
}

export interface ManifestColour {
  id: string;
  name: string;
  aliases?: string[];
  videos: ManifestFile[];
  /** True for a car whose videos sit outside any colour folder. */
  noColourChoice?: boolean;
}

export interface ManifestCar {
  id: string;
  name: string;
  folder: string;
  aliases: string[];
  brochure: ManifestFile | null;
  colours: ManifestColour[];
  readyToSend: boolean;
}

export interface SalesManifest {
  importedFrom: string | null;
  cars: ManifestCar[];
  warnings: string[];
}

export const SALES_MANIFEST: SalesManifest = {
  "importedFrom": "Monza AI sales",
  "cars": [
    {
      "id": "mhero-1",
      "name": "Mhero 1",
      "folder": "Mhero 1",
      "aliases": [
        "mhero 1",
        "m hero 1",
        "m-hero 1",
        "mhero i"
      ],
      "brochure": {
        "fileName": "M-Hero I 2026 catalogue.pdf",
        "bytes": 33721887
      },
      "colours": [
        {
          "id": "black",
          "name": "Black",
          "aliases": [
            "black"
          ],
          "videos": []
        },
        {
          "id": "grey",
          "name": "Grey",
          "aliases": [
            "grey"
          ],
          "videos": [
            {
              "fileName": "A Bold approach The M-Hero I For more info contact us on +96170708585#mhero #mherolebanon #monza.mp4",
              "bytes": 3320273
            }
          ]
        }
      ],
      "readyToSend": true
    },
    {
      "id": "mhero-2",
      "name": "Mhero 2",
      "folder": "Mhero 2",
      "aliases": [
        "mhero 2",
        "m hero 2",
        "m-hero 2",
        "mhero ii"
      ],
      "brochure": {
        "fileName": "M-Hero II 2026 catalogue .pdf",
        "bytes": 7654327
      },
      "colours": [
        {
          "id": "black",
          "name": "Black",
          "aliases": [
            "black"
          ],
          "videos": [
            {
              "fileName": "Traditionally configured for your adventures ahead#mhero #mherolebanon #mhero817 #monzasal #free.mp4",
              "bytes": 4844545
            }
          ]
        },
        {
          "id": "green",
          "name": "Green",
          "aliases": [
            "green"
          ],
          "videos": [
            {
              "fileName": "Welcoming a new model into our family. The All-New M-Hero II with 1,300KM (CLTC) of range!Contac.mp4",
              "bytes": 2147172
            }
          ]
        },
        {
          "id": "white",
          "name": "White",
          "aliases": [
            "white"
          ],
          "videos": [
            {
              "fileName": "Not for everyone.And that's the point.700HP.1,300KM combined range.Pearl White elegance.Bordeaux.mp4",
              "bytes": 5818082
            }
          ]
        }
      ],
      "readyToSend": true
    },
    {
      "id": "voyah-courage",
      "name": "Voyah Courage",
      "folder": "Voyah Courage",
      "aliases": [
        "voyah courage",
        "courage"
      ],
      "brochure": {
        "fileName": "Voyah courage 2026 catalogue.pdf",
        "bytes": 31465661
      },
      "colours": [
        {
          "id": "black",
          "name": "Black",
          "aliases": [
            "black"
          ],
          "videos": [
            {
              "fileName": "All Black Voyah Courage Innovative design and technology.AWD Full-Electric with 470KM of range.4.mp4",
              "bytes": 3331350
            }
          ]
        },
        {
          "id": "grey",
          "name": "Grey",
          "aliases": [
            "grey"
          ],
          "videos": [
            {
              "fileName": "Understated color. Overstated presence.Voyah Courage in Crayon Grey.#voyah #voyahlebanon #voyahc.mp4",
              "bytes": 4000188
            }
          ]
        },
        {
          "id": "white",
          "name": "White",
          "aliases": [
            "white"
          ],
          "videos": [
            {
              "fileName": "Courage White.mov",
              "bytes": 121160738
            }
          ]
        }
      ],
      "readyToSend": true
    },
    {
      "id": "voyah-dream",
      "name": "Voyah Dream",
      "folder": "Voyah Dream",
      "aliases": [
        "voyah dream",
        "dream"
      ],
      "brochure": {
        "fileName": "Voyah dream 2026 catalogue.pdf",
        "bytes": 21409076
      },
      "colours": [
        {
          "id": "standard",
          "name": "Standard",
          "aliases": [],
          "videos": [
            {
              "fileName": "When the voyah dream makes an appearance, it's hard to not take a look and appreciate the subtle.mp4",
              "bytes": 7995542
            }
          ],
          "noColourChoice": true
        }
      ],
      "readyToSend": true
    },
    {
      "id": "voyah-free-comp",
      "name": "Voyah Free Comp",
      "folder": "Voyah Free Comp",
      "aliases": [
        "voyah free comp",
        "free comp"
      ],
      "brochure": {
        "fileName": "Voyah free Competition 2026 catalogue.pdf",
        "bytes": 21090188
      },
      "colours": [
        {
          "id": "black",
          "name": "Black",
          "aliases": [
            "black"
          ],
          "videos": [
            {
              "fileName": "Dark on the outside. Light within.The new Voyah Free 318 Competition blends a bold black presenc.mp4",
              "bytes": 7720103
            }
          ]
        },
        {
          "id": "green",
          "name": "Green",
          "aliases": [
            "green"
          ],
          "videos": [
            {
              "fileName": "VOYAH FREE - COMPETITION.mp4",
              "bytes": 65687995
            }
          ]
        },
        {
          "id": "grey",
          "name": "Grey",
          "aliases": [
            "grey"
          ],
          "videos": [
            {
              "fileName": "Voyah Free Grey.mp4",
              "bytes": 7254907
            }
          ]
        },
        {
          "id": "sage",
          "name": "Sage",
          "aliases": [
            "sage"
          ],
          "videos": [
            {
              "fileName": "copy_8CBB8FE5-6D80-4FB1-B1E3-655D22330D63.mov",
              "bytes": 28222397
            }
          ]
        },
        {
          "id": "white",
          "name": "White",
          "aliases": [
            "white"
          ],
          "videos": [
            {
              "fileName": "Pearl white elegance. Black suede attitude. Red Brembo confidence. Effortlessly smooth - The Voy.mp4",
              "bytes": 4915937
            }
          ]
        }
      ],
      "readyToSend": true
    },
    {
      "id": "voyah-passion",
      "name": "Voyah Passion",
      "folder": "Voyah Passion",
      "aliases": [
        "voyah passion",
        "passion"
      ],
      "brochure": {
        "fileName": "Voyah passion 2026 catalogue.pdf",
        "bytes": 71628445
      },
      "colours": [
        {
          "id": "black",
          "name": "Black",
          "aliases": [
            "black"
          ],
          "videos": [
            {
              "fileName": "Crafted to stand apart. The all-new Voyah Passion L in Black with a Grey interior.#voyah #voyahl.mp4",
              "bytes": 3716029
            }
          ]
        },
        {
          "id": "white",
          "name": "White",
          "aliases": [
            "white"
          ],
          "videos": [
            {
              "fileName": "Pearly white elegance, electrifying power & the freedom to explore.Explore the Voyah Passion wit.mp4",
              "bytes": 3566131
            }
          ]
        }
      ],
      "readyToSend": true
    },
    {
      "id": "voyah-passion-l",
      "name": "Voyah Passion L",
      "folder": "Voyah Passion L",
      "aliases": [
        "voyah passion l",
        "passion l"
      ],
      "brochure": {
        "fileName": "VOYAH PASSION L Catalogue 2026.pdf",
        "bytes": 1765326
      },
      "colours": [
        {
          "id": "black",
          "name": "Black",
          "aliases": [
            "black"
          ],
          "videos": [
            {
              "fileName": "Crafted to stand apart. The all-new Voyah Passion L in Black with a Grey interior.#voyah #voyahl.mp4",
              "bytes": 3716029
            }
          ]
        },
        {
          "id": "grey",
          "name": "Grey",
          "aliases": [
            "grey"
          ],
          "videos": [
            {
              "fileName": "The All-New Voyah Passion L PHEV has arrived.Finished in an elegant Titanium Grey with a bold Re.mp4",
              "bytes": 3280129
            }
          ]
        }
      ],
      "readyToSend": true
    },
    {
      "id": "voyah-taishan",
      "name": "Voyah Taishan",
      "folder": "Voyah Taishan",
      "aliases": [
        "voyah taishan",
        "taishan"
      ],
      "brochure": {
        "fileName": "VOYAH TAISHAN Catalogue 2026.pdf",
        "bytes": 3238263
      },
      "colours": [
        {
          "id": "black",
          "name": "Black",
          "aliases": [
            "black"
          ],
          "videos": [
            {
              "fileName": "copy_C81B4DD7-817D-4B05-883F-B99DC31E6918 (1).mov",
              "bytes": 50749376
            }
          ]
        },
        {
          "id": "blue",
          "name": "Blue",
          "aliases": [
            "blue"
          ],
          "videos": [
            {
              "fileName": "copy_F7D2E670-0047-47CB-9379-94EDBB8226EE.mov",
              "bytes": 50164721
            }
          ]
        },
        {
          "id": "grey",
          "name": "Grey",
          "aliases": [
            "grey"
          ],
          "videos": [
            {
              "fileName": "The VOYAH Taishan - where flagship luxury meets intelligent performance.670 combined HP - Dual-M.mp4",
              "bytes": 9169160
            }
          ]
        }
      ],
      "readyToSend": true
    }
  ],
  "warnings": [
    "Mhero 1 / Black: folder is empty — cannot be offered.",
    "Voyah Dream: videos are not in colour folders — treated as one option with no colour choice.",
    "THE SAME VIDEO IS IN Voyah Passion / Black AND Voyah Passion L / Black — \"Crafted to stand apart. The all-new Voyah Passion L in Black with a Grey interior.#voyah #voyahl.mp4\". One of them is the wrong car; only you know which."
  ]
};
