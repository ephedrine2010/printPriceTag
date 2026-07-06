//========= search in price update======
// ignore_for_file: prefer_interpolation_to_compose_strings

import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:dio/dio.dart';
import 'package:get/get.dart';
import 'package:telescopeassistant/services/authMetaData.dart';
import 'package:telescopeassistant/services/barcodeScanner/addvatToprice.dart';
import 'package:telescopeassistant/services/dateToInt.dart';
import 'package:telescopeassistant/services/db/local/config/configs.dart';

import '../../models/itemDataModel.dart';
import '../../models/website_itemData.dart';
import '../MMYYWidget.dart';
import '../db/local/localDbConnection.dart';
import '../readMedicineExpire.dart';
import '../searchImage.dart';

searchInHistory(barcode, bool onlyName) async {
  itemdataModel xItem = itemdataModel();

  //------- extract expire date from medicine
  if (barcode.length > 16) {
    var TT = readMedicineExpire(barcode);
    if (TT != null) {
      final xMMYYProvider = Get.put(MMYYwidgetProvider());
      xMMYYProvider.MMonth = TT['MM'].toString();
      xMMYYProvider.YYear = TT['YY'].toString();
      xMMYYProvider.category = 'Medicine';
      xMMYYProvider.update();
    }
    barcode = barcode.toString().substring(2, 16);
  }

  //-----------------------------------------------
  Map<String, dynamic> result = {};

  await localDBsearch(barcode.toString(), false).then((xData) async {
    if (xData != null) {
      itemdataModel TT = xData;
      barcode = TT.rms_code;
    }
  });

  barcode = num.parse(barcode.toString());
  String searchField = '';
  if (barcode.toString().length == 9) {
    searchField = 'sku';
  } else if (barcode.toString().length > 9 || barcode.toString().length < 9) {
    searchField = 'barcode';
  }

  // 0-  search in price update history for today only
  num yesterdayDate = dateToInt().convertDateToInt(DateTime.now(), -7);
  await FirebaseFirestore.instance
      .collection('master_updatedPrices')
      .where(searchField, isEqualTo: barcode)
      .where('updateDate', isGreaterThan: yesterdayDate)
      .get()
      .then((xData) async {
    if (xData.docs.isNotEmpty) {
      result = xData.docs[0].data();

      xItem.nat_barcode = double.parse(result['barcode'].toString());
      xItem.gtin_barcode = result['barcode'].toString();
      xItem.rms_code = result['sku'];
      xItem.eng_name = result['name_en'];
      xItem.ar_name = result['name_ar'];
      xItem.vat = int.parse(result['vat'].toString());
      xItem.item_price = addVatToPrice(result['newPrice'], result['vat']);
      xItem.imgUrl = await searchImg().searchImage(xItem.rms_code);
    }
  });

  if (xItem.eng_name != null) {
    return xItem;
  }

  //------------------------------------------------------------

  // 1- search in direct website use scrap
  await startScrap(barcode, null).then((xData) {
    if (xData != null) {
      xItem = xData;
      final xMMYYProviderr = Get.put(MMYYwidgetProvider());
      xMMYYProviderr.category = xItem.CatName;
    }
  });
  if (xItem.eng_name != null) {
    return xItem;
  }
  //------------------------------------------------------------
  // 2-  search in price update history
  await FirebaseFirestore.instance
      .collection('master_updatedPrices')
      .where(searchField, isEqualTo: barcode)
      .get()
      .then((xData) async {
    if (xData.docs.isNotEmpty) {
      result = xData.docs[0].data();
      xItem.nat_barcode = double.parse(result['barcode'].toString());
      xItem.gtin_barcode = result['barcode'].toString();
      xItem.rms_code = result['sku'];
      xItem.eng_name = result['name_en'];
      xItem.ar_name = result['name_ar'];
      xItem.vat = int.parse(result['vat'].toString());
      xItem.item_price = addVatToPrice(result['newPrice'], result['vat']);
      xItem.imgUrl = await searchImg().searchImage(xItem.nat_barcode);
    }
  });

  if (xItem.eng_name != null) {
    return xItem;
  }

  //-------------------------------------------------------------
  // 3- search in local db
  await localDBsearch(barcode.toString()).then((xValue) {
    xItem = xValue;
  });
  if (xItem.eng_name != null) return xItem;

  return xItem;
}

//============== master plus===================
masterPlus(barcode) async {
  Map<String, dynamic> result = {};
  itemdataModel xItem = itemdataModel();

  String searchField = '';
  if (barcode.toString().length == 9) {
    searchField = 'sku';
  } else {
    searchField = 'ibC_GTIN';
    await localDBsearch(barcode.toString()).then((xRes) {
      if (xRes != null) {
        xItem = xRes;
        searchField = 'sku';
        barcode = xItem.rms_code;
      }
    });
  }

  //=====get item web link
  var fireB = await FirebaseFirestore.instance
      .collection('master_links')
      .where(searchField, isEqualTo: barcode)
      .get()
      .then((xData) async {
    if (xData.docs.isNotEmpty) {
      if (xData.docs[0].data()['link'].toString().length > 10) {
        await startScrap(barcode, null).then((xScrapData) {
          if (xScrapData != null) {
            result = xScrapData;
            result['barcode'] = xData.docs[0].data()['ibC_GTIN'];
            return result;
          } else {
            return null;
          }
        });
      }
    }
  });

  return result;
}

startScrap(barcode, vat) async {
  WebsiteItemData websiteItemData;
  itemdataModel xItem = itemdataModel();
  await localDBsearch(barcode.toString(), false).then((xData) async {
    if (xData != null) {
      itemdataModel TT = xData;

      final dio = Dio();
      final response = await dio.get(
          'https://www.nahdionline.com/api/analytics/product',
          queryParameters: {
            'skus': TT.rms_code.toString(),
            'language': 'en',
            'region': 'SA',
            'category_id': '15125'
          });

      if (response.statusCode == 200 && response.data.length > 0) {
        // Convert the response data to WebsiteItemData model

        websiteItemData = WebsiteItemData.fromJson(response.data[0]);
        xItem.rms_code = websiteItemData.itemId;
        xItem.eng_name = websiteItemData.itemName;
        xItem.ar_name = TT.ar_name;
        xItem.nat_barcode = TT.nat_barcode;
        xItem.gtin_barcode = TT.gtin_barcode;
        if (websiteItemData.shelfPrice == websiteItemData.price) {
          xItem.item_price = websiteItemData.price;
        } else {
          if (websiteItemData.price > websiteItemData.shelfPrice) {
            if (websiteItemData.price == (TT.item_price!)) {
              xItem.item_price = addVatToPrice(websiteItemData.price, TT.vat);
            } else {
              xItem.item_price = websiteItemData.price;
            }
          } else {
            if (websiteItemData.shelfPrice == (TT.item_price!)) {
              xItem.item_price =
                  addVatToPrice(websiteItemData.shelfPrice, TT.vat);
            } else {
              xItem.item_price = websiteItemData.shelfPrice;
            }
          }
        }
        xItem.imgUrl = websiteItemData.itemImageLink;
        xItem.is_smart = authMetaData.smartBrands.any((brand) =>
            brand['brand_name'].toString().toLowerCase() ==
            websiteItemData.itemBrand.toLowerCase());
        xItem.CatName =
            websiteItemData.imfDivision.toString()[0].toUpperCase() +
                websiteItemData.imfDivision.substring(1).toLowerCase();

        xItem.vat = TT.vat;

        //add to firebase history
        //+++++++++++++++++++++++++++++++
        await FirebaseFirestore.instance
            .collection('master_links')
            .doc(xItem.nat_barcode.toString())
            .set({
          'ibC_GTIN': barcode,
          'img': xItem.imgUrl,
          //'link': link,
          'sku': xItem.rms_code,
          'vat': vat
        });
              //+++++++++++++++++++++++++++++++
        return xItem;
      }
    } else {
      return null;
    }
  });

  return xItem;
}

//-----------------------------------------------------------
localDBsearch(String barcode, [bool vatRequired = true]) async {
  var localDb = localSqlDB();
  List result = [];

  //sku
  if (barcode.length == 9) {
    var TT = await localDb.readRawData(
        'select * from localmaster where sku = ${int.parse(barcode)}');
    if (TT == null) {
      var xx = await localDb.readRawData(
          'select * from localmaster where barcode = ${int.parse(barcode)}');
      if (xx != null) result = xx;
    } else {
      result = TT;
    }
  }

  //barcode
  if (barcode.length < 9) {
    var TT = await localDb.readRawData(
        'select * from localmaster where barcode = ${double.parse(barcode)}');
    if (TT != null) result = TT;
  }

  //barcode
  if (barcode.length < 14 && barcode.length > 9) {
    var TT = await localDb.readData(
        'localmaster', 'barcode= ?', num.parse(barcode.toString()));
    if (TT != null) result = TT;
  }

  //barcode
  if (barcode.length > 13) {
    var TT = await localDb
        .readRawData('select * from localmaster where gtin = \'$barcode\'');
    if (TT != null) result = TT;
  }

  itemdataModel xItem = itemdataModel();

  if (result.isNotEmpty) {
    Map<String, dynamic> xRes = <String, dynamic>{};
    xRes = result[0];

    xItem.rms_code = xRes['sku'];

    try {
      if (xRes['gtin'].toString().length > 3) {
        xItem.nat_barcode = double.parse(xRes['gtin'].toString());
      } else {
        xItem.nat_barcode = double.parse(xRes['barcode'].toString());
      }
    } catch (e) {
      xItem.nat_barcode = double.parse(barcode);
    }

    //xItem.nat_barcode = result[0]['barcode'];
    xItem.gtin_barcode = xItem.nat_barcode.toString();
    xItem.eng_name = xRes['name_en'];
    xItem.ar_name = xRes['name_ar'];
    xItem.imgUrl = config.empty_img; //xRes['item_image_link'].toString();
    xItem.vat = xRes['vat'];
    //if price not null
    //num TT = num.parse(result[0]['item_price'].toString());

    if (xRes['item_price'] != null) {
      if (vatRequired) {
        double vattt = double.parse(xRes['vat'].toString()) + 100;

        xItem.item_price = double.parse(
            (double.parse(xRes['item_price'].toString()) * vattt / 100)
                .toStringAsFixed(2));
      } else {
        xItem.item_price = double.parse(xRes['item_price'].toString());
      }
    } else {
      xItem.item_price = 0;
    }
  }

  return xItem;
}
