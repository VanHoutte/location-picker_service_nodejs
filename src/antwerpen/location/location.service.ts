import request = require("request");
import filterSqlVar from "../../helpers/filterSqlVar";
import { handleResponse, handleResponseFn } from "../../helpers/handleResponse";
import lambertToLatLng from "../../helpers/lambertToLatLng";
import { formatAddress, formatLocationItem, getStreetAndNr} from "../../helpers/format";
import { LocationItem } from "../../types";
import { LocationServiceConfig } from "../types";

const getRequestOptions = (url: string, auth?: string) => {
    return {
        method: "GET",
        url,
        json: true,
        headers: auth
            ? {
                  Authorization: `Basic ${auth}`,
              }
            : {},
    };
};

const sortByNameFn = (a: LocationItem, b: LocationItem) => a.name.toLowerCase().localeCompare(b.name.toLowerCase());

/**
 * Create a function that calls the CRAB and SOLR services and finds locations
 *
 * matching a search string and for a specific set of location types (street, number, poi)
 */
export = function createLocationService(
    config: LocationServiceConfig,
): (search: string, types: string, id?: number) => Promise<LocationItem[]> {
    const getAddress = (street: string, num: string, callback: handleResponseFn<LocationItem>) => {
        // quotes need to be doubled for escaping into sql
        street = encodeURIComponent(filterSqlVar(street).replace(/'/g, "''"));
        num = encodeURIComponent(filterSqlVar(num));
        const url =
            config.crabUrl +
            "?f=json&orderByFields=HUISNR&where=GEMEENTE='Antwerpen' and " +
            `STRAATNM LIKE '${street}%' and HUISNR='${num}' ` +
            "and APPTNR='' and BUSNR=''&outFields=*";
        const responseHandler = handleResponse('features', formatAddress, callback);
        request(getRequestOptions(url), responseHandler);
    };

    const getAddressByID = (id: number, callback: handleResponseFn<LocationItem>) => {
        const url = `${config.crabUrl}?f=json&orderByFields=HUISNR&where=ID=${id}&outFields=*`;
        const responseHandler = handleResponse('features', formatAddress, callback);
        request(getRequestOptions(url), responseHandler);
    };

    const getLocationsBySearch = (search: string, types: string[], callback: handleResponseFn<LocationItem>) => {
        search = filterSqlVar(search);
        if (!types.includes("poi")) {
            search = `layer:straatnaam AND ${search}`;
        } else if (!types.includes("street")) {
            search = `NOT layer:straatnaam AND ${search}`;
        }
        const url =
            config.solrGisUrl +
            "?wt=json&rows=5&solrtype=gislocaties&dismax=true&bq=exactName:DISTRICT^20000.0" +
            "&bq=layer:straatnaam^20000.0" +
            `&q=(${encodeURIComponent(search)})`;
        const responseHandler = handleResponse(
            "response.docs",
            formatLocationItem,
            callback);

        request(getRequestOptions(url, config.solrGisAuthorization), responseHandler);
    };

    return (search: string, types: string = "street,number,poi", id?: number): Promise<LocationItem[]> => {
        return new Promise((resolve, reject) => {
            const callback = (error: any, result: LocationItem[]) => {
                if (result) {
                    result = result.sort(sortByNameFn);
                }
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            };
            try {
                const { street, num } = getStreetAndNr(search);
                const typesArray = types.split(",");
                if (id) {
                    // look for a specific addressid
                    getAddressByID(id, callback);
                } else if (!!num && typesArray.includes("number")) {
                    // look for a specific address (with number)
                    getAddress(street, num, callback);
                } else if (typesArray.includes("poi") || typesArray.includes("street")) {
                    // look for a street or point of interest (without number)
                    getLocationsBySearch(street, typesArray, callback);
                } else {
                    resolve([]);
                }
            } catch (e) {
                reject(e);
            }
        });
    };
};
