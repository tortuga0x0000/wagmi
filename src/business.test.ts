import { describe, expect, test } from '@jest/globals';
import { getTickers } from './business';

describe('getTickers', function () {
    test('should match ticker starting with a $', function () {
        expect(getTickers("I have some $BTC")).toEqual(["BTC"]);
    });
    test('should match ticker starting with a $', function () {
        expect(getTickers("I also have ETH")).toEqual(["ETH"]);
    });
    test('should match lower cap with $', function () {
        expect(getTickers("I have some $btc")).toEqual(["BTC"]);
    });
    test('should get the 3 supported format in one message', function () {
        expect(getTickers("I have some $btc, $BNB and ETH")).toEqual(["BTC", "BNB", "ETH"]);
    });
    test('should detect uppercase format without $ at the start of the message', function() {
        expect(getTickers("ETH flips")).toEqual(["ETH"])
    })
});